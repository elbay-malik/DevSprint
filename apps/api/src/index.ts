import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import {
  convertToModelMessages,
  validateUIMessages,
  type InferUITools,
  type UIDataTypes,
  type UIMessage,
} from 'ai'
import { API_ROUTES } from '@devsprint/shared'
import type { AppEnv } from './env'
import { workspaceStore } from './workspace'
import { createCopilotAgent } from './agent/agent'
import { createStepAuditLogger } from './agent/audit'
import { describeError, toClientErrorMessage } from './agent/errors'
import { ModelConfigError, resolveModel } from './agent/model'
import { buildSystemPrompt } from './agent/system-prompt'
import { createReadTools, type ReadTools } from './agent/tools'

/** Mirrors the SPA's `DevSprintUIMessage` so tool parts validate against the real schemas. */
type ChatUIMessage = UIMessage<unknown, UIDataTypes, InferUITools<ReadTools>>

const app = new Hono<{ Bindings: AppEnv }>()
const tools = createReadTools(workspaceStore)

// env bindings are only available per-request, so the cors middleware is
// constructed inside the handler instead of at module scope
app.use('/api/*', (c, next) =>
  cors({
    origin: c.env.CORS_ORIGIN,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: ['X-DevSprint-Model'],
    maxAge: 86400,
  })(c, next),
)

app.get('/api/health', (c) => c.json({ ok: true }))

app.get(API_ROUTES.workspace, (c) => c.json(workspaceStore.get()))

function invalidInput(c: Context<{ Bindings: AppEnv }>, message: string) {
  return c.json({ error: { code: 'INVALID_INPUT', message } }, 400)
}

app.post(API_ROUTES.chat, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return invalidInput(c, 'Request body must be JSON.')
  }
  const messages =
    typeof body === 'object' && body !== null && 'messages' in body ? body.messages : undefined
  if (!Array.isArray(messages)) {
    return invalidInput(c, '`messages` must be an array of UI messages.')
  }

  let uiMessages: ChatUIMessage[]
  try {
    uiMessages = await validateUIMessages<ChatUIMessage>({ messages, tools })
  } catch (error) {
    return invalidInput(c, `Invalid UI messages: ${describeError(error).message}`)
  }

  let resolved
  try {
    resolved = resolveModel(c.env)
  } catch (error) {
    if (error instanceof ModelConfigError) {
      return c.json({ error: { code: 'MODEL_NOT_CONFIGURED', message: error.message } }, 503)
    }
    throw error
  }
  const { model, label } = resolved

  const agent = createCopilotAgent({
    model,
    instructions: buildSystemPrompt(workspaceStore.get()),
    tools,
  })

  // The request signal is what makes the composer's Stop button real: aborting
  // the fetch ends the agent loop server-side instead of leaving it running.
  const result = await agent.stream({
    // A turn the user stopped leaves an assistant tool call with no result.
    // Without this the NEXT message throws MessageConversionError and the chat
    // is wedged until reload — pruning the dangling call is what lets the
    // conversation continue after Stop.
    messages: await convertToModelMessages(uiMessages, { tools, ignoreIncompleteToolCalls: true }),
    abortSignal: c.req.raw.signal,
    onStepFinish: createStepAuditLogger(label),
  })

  // 'Content-Encoding: Identity' defeats wrangler dev/miniflare response
  // buffering so tokens actually stream locally (workers-sdk#8004); harmless
  // in production.
  return result.toUIMessageStreamResponse({
    headers: { 'Content-Encoding': 'Identity', 'X-DevSprint-Model': label },
    onError: (error) => {
      console.error(
        JSON.stringify({ event: 'model-error', model: label, error: describeError(error) }),
      )
      return toClientErrorMessage(error)
    },
  })
})

export default app
