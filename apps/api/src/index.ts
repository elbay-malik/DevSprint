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
import { workspaceStub, type WorkspaceApi } from './workspace/durable-object'
import { createCopilotAgent } from './agent/agent'
import { createStepAuditLogger } from './agent/audit'
import { describeError, toClientErrorMessage } from './agent/errors'
import { ModelConfigError, resolveModel } from './agent/model'
import { buildSystemPrompt } from './agent/system-prompt'
import { createTools, MCP_OWNED_TOOL_NAMES, type DevSprintTools } from './agent/tools'
import { createMcpIssueTools } from './agent/mcp-tools'
import { resolveApprovalSecret, settleApprovals } from './agent/approvals'

/** Mirrors the SPA's `DevSprintUIMessage` so tool parts validate against the real schemas. */
type ChatUIMessage = UIMessage<unknown, UIDataTypes, InferUITools<DevSprintTools>>

const app = new Hono<{ Bindings: AppEnv }>()

/**
 * The workspace lives in a Durable Object, so the tool set is built per request
 * from the request's bindings rather than once at module scope.
 */
function workspaceOf(env: AppEnv): WorkspaceApi {
  return workspaceStub(env.WORKSPACE)
}

let warnedLocalTools = false

/**
 * The agent's tools. The four issue tools come from the issues MCP server — the
 * same endpoint an external host talks to, so both clients exercise one
 * implementation (ADR-0002); the rest are still defined locally until the
 * deploys and analytics servers exist.
 *
 * If the MCP server cannot be reached the agent falls back to the local copies,
 * because a chat that half-works beats a chat that errors. That fallback is
 * reported rather than hidden: the response carries the source in a header, so
 * a demo cannot look like it is proving the MCP path while quietly not using it.
 */
async function buildTools(
  env: AppEnv,
  workspace: WorkspaceApi,
): Promise<{ tools: DevSprintTools; source: 'mcp' | 'local' }> {
  const local = createTools(workspace)
  if (!env.MCP_ISSUES) return { tools: local, source: 'local' }

  try {
    const issueTools = await createMcpIssueTools({
      fetch: (input, init) => env.MCP_ISSUES.fetch(input, init),
    })
    return { tools: { ...local, ...issueTools }, source: 'mcp' }
  } catch (error) {
    if (!warnedLocalTools) {
      warnedLocalTools = true
      console.warn(
        JSON.stringify({
          event: 'mcp-unavailable',
          tools: MCP_OWNED_TOOL_NAMES,
          error: describeError(error),
        }),
      )
    }
    return { tools: local, source: 'local' }
  }
}

// env bindings are only available per-request, so the cors middleware is
// constructed inside the handler instead of at module scope
app.use('/api/*', (c, next) =>
  cors({
    origin: c.env.CORS_ORIGIN,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: ['X-DevSprint-Model', 'X-DevSprint-Tools'],
    maxAge: 86400,
  })(c, next),
)

app.get('/api/health', (c) => c.json({ ok: true }))

app.get(API_ROUTES.workspace, async (c) => c.json(await workspaceOf(c.env).snapshot()))

/**
 * Restores the seed. The demo is a mock workspace that approved writes mutate,
 * so both the "Reset demo" affordance in docs/wireframes.md §1 and the browser
 * tests need a way back to a known board. Phase 9 replaces this with the daily
 * reset once the workspace lives in D1.
 */
app.post(API_ROUTES.workspaceReset, async (c) => c.json(await workspaceOf(c.env).reset()))

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

  const workspace = workspaceOf(c.env)
  const { tools, source: toolSource } = await buildTools(c.env, workspace)

  let uiMessages: ChatUIMessage[]
  try {
    uiMessages = await validateUIMessages<ChatUIMessage>({ messages, tools })
  } catch (error) {
    return invalidInput(c, `Invalid UI messages: ${describeError(error).message}`)
  }

  // An approval that has already been acted on is downgraded to a denial rather
  // than executed again. The SDK's signature stops forgery but carries no nonce,
  // so a captured approval would otherwise replay indefinitely (ADR-0003 asks
  // for both to be covered).
  const { replayed } = settleApprovals(uiMessages)
  if (replayed > 0) {
    console.warn(JSON.stringify({ event: 'approval-replay-blocked', count: replayed }))
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
    instructions: buildSystemPrompt(await workspace.snapshot()),
    tools,
    approvalSecret: resolveApprovalSecret(c.env.TOOL_APPROVAL_SECRET),
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
    headers: {
      'Content-Encoding': 'Identity',
      'X-DevSprint-Model': label,
      'X-DevSprint-Tools': toolSource,
    },
    onError: (error) => {
      console.error(
        JSON.stringify({ event: 'model-error', model: label, error: describeError(error) }),
      )
      return toClientErrorMessage(error)
    },
  })
})

export { WorkspaceDO } from './workspace/durable-object'

export default app
