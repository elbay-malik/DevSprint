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
import { corsOriginMatcher } from './cors'
import { workspaceStub, type WorkspaceApi } from './workspace/durable-object'
import { createCopilotAgent } from './agent/agent'
import { createStepAuditLogger } from './agent/audit'
import { describeError, toClientErrorMessage } from './agent/errors'
import { ModelConfigError, resolveModel } from './agent/model'
import { buildSystemPrompt } from './agent/system-prompt'
import { createTools, MCP_OWNED_TOOL_NAMES, type DevSprintTools } from './agent/tools'
import { createMcpIssueTools } from './agent/mcp-tools'
import { resolveApprovalSecret, settleApprovals } from './agent/approvals'
import { createTurnTracer, resolveTracingConfig } from './agent/tracing'
import {
  BUDGET_REACHED_MESSAGE,
  messageOnlyResponse,
  RATE_LIMITED_MESSAGE,
  rateLimitKey,
  resolveDailyTokenCap,
  type RateLimitBinding,
} from './agent/limits'

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
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<{ tools: DevSprintTools; source: 'mcp' | 'local' }> {
  const local = createTools(workspace, { waitUntil })
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
    origin: corsOriginMatcher(c.env.CORS_ORIGIN),
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: [
      'X-DevSprint-Model',
      'X-DevSprint-Tools',
      'X-DevSprint-Trace',
      'X-DevSprint-Limit',
    ],
    maxAge: 86400,
  })(c, next),
)

app.get('/api/health', (c) => c.json({ ok: true }))

app.get(API_ROUTES.workspace, async (c) => c.json(await workspaceOf(c.env).snapshot()))

/**
 * Restores the seed. The demo is a mock workspace that approved writes mutate,
 * so both the "Reset demo" affordance in docs/wireframes.md §1 and the browser
 * tests need a way back to a known board. Independent of the workspace
 * Durable Object's own daily reset alarm (ADR-0014) — this is the manual
 * trigger for the same effect, not something the alarm supersedes.
 */
app.post(API_ROUTES.workspaceReset, async (c) => c.json(await workspaceOf(c.env).reset()))

/**
 * Cancels a running deployment (scenario S-C, variant C2).
 *
 * The obvious design is to hang cancellation off the request's abort signal —
 * the user hits Stop, the fetch aborts, `run_deployment` sees it. That does not
 * work here: a client that stops reading a streamed response does not reliably
 * abort the Worker's request, so the tool's signal never fires and the run
 * finishes as if nobody had asked. Rather than pretend, the Cancel button says
 * so out of band, and the deploy loop reads the workspace between stages.
 *
 * It stays an http route rather than becoming a `cancel_deployment` tool: the
 * cancel comes from a button, so routing it through the model would make the
 * outcome depend on the model choosing to call it (docs/tool-inventory.md §4).
 */
app.post(API_ROUTES.deploymentCancel, async (c) => {
  const result = await workspaceOf(c.env).finishDeployment({
    deploymentId: c.req.param('id'),
    status: 'cancelled',
  })
  if (result.ok) return c.json(result)
  // A run that already finished is a conflict, not a missing one — saying 200
  // here would tell the user their cancel landed when the release had shipped.
  return c.json(result, result.error.code === 'DEPLOY_ALREADY_SETTLED' ? 409 : 404)
})

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
  /**
   * Keeps a write alive that the response is no longer waiting on — a
   * deployment settling itself after the client has gone.
   *
   * Read lazily and guarded, because `c.executionCtx` throws rather than
   * returning undefined when there is no Worker request behind the call, which
   * is exactly the case in the unit suite that drives the app directly.
   */
  const waitUntil = (promise: Promise<unknown>) => {
    try {
      c.executionCtx.waitUntil(promise)
    } catch {
      // Nothing is going to cut the promise short here, so letting it run is
      // the whole job.
      void promise
    }
  }
  // Per-IP throttle first: it is the cheapest check and the one that protects
  // everything after it. Absent binding means absent limit, which is what local
  // dev and CI get — the limiter is a deploy-time protection, not a dependency.
  // Typed `| undefined` on purpose: the generated binding type says it is always
  // there, and under vitest or a deploy without the binding it is not.
  const limiter: RateLimitBinding | undefined = c.env.CHAT_RATE_LIMIT
  const clientKey = rateLimitKey(c.req.raw)
  if (limiter && clientKey !== undefined) {
    const { success } = await limiter.limit({ key: clientKey })
    if (!success) {
      console.warn(JSON.stringify({ event: 'rate-limited' }))
      // A readable turn rather than a bare 429: the transcript stays usable and
      // the SPA needs no special case for it.
      return messageOnlyResponse(RATE_LIMITED_MESSAGE, { 'X-DevSprint-Limit': 'rate' })
    }
  }

  const { tools, source: toolSource } = await buildTools(c.env, workspace, waitUntil)

  let uiMessages: ChatUIMessage[]
  try {
    uiMessages = await validateUIMessages<ChatUIMessage>({ messages, tools })
  } catch (error) {
    return invalidInput(c, `Invalid UI messages: ${describeError(error).message}`)
  }

  // An approval that has already been acted on is downgraded to a denial rather
  // than executed again. The SDK's signature stops forgery but carries no nonce,
  // so a captured approval would otherwise replay indefinitely (ADR-0003 asks
  // for both to be covered). The ledger this checks against lives in the
  // workspace, not this isolate (ADR-0014), so the guarantee holds across
  // restarts and across whichever isolate a later request lands on.
  const { replayed } = await settleApprovals(uiMessages, workspace)
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

  // The day's budget. Only a real provider spends anything, so the scripted
  // mock is exempt — otherwise local dev and CI would be rationing a resource
  // they do not consume.
  const dailyCap = resolveDailyTokenCap(c.env.DAILY_TOKEN_CAP)
  if (dailyCap !== undefined && label !== 'mock') {
    const usage = await workspace.modelUsage()
    if (usage.tokens >= dailyCap) {
      console.warn(JSON.stringify({ event: 'budget-reached', day: usage.day, spent: usage.tokens }))
      return messageOnlyResponse(BUDGET_REACHED_MESSAGE, {
        'X-DevSprint-Model': label,
        'X-DevSprint-Limit': 'budget',
      })
    }
  }

  // One trace per turn (ADR-0015). Undefined whenever Langfuse is not
  // configured, which is the normal case locally and in CI.
  const tracingConfig = resolveTracingConfig(c.env)
  const turnTracer = tracingConfig ? createTurnTracer(tracingConfig) : undefined

  const agent = createCopilotAgent({
    model,
    instructions: buildSystemPrompt(await workspace.snapshot()),
    tools,
    approvalSecret: resolveApprovalSecret(c.env.TOOL_APPROVAL_SECRET),
    ...(turnTracer ? { tracer: turnTracer.tracer } : {}),
    // Spend is recorded after the fact, on `waitUntil`: the answer has already
    // streamed by then, and a turn still costs whatever it cost.
    ...(dailyCap !== undefined && label !== 'mock'
      ? { onUsage: (tokens: number) => waitUntil(workspace.recordModelUsage(tokens)) }
      : {}),
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
  // in production. The charset is what an event stream always is, said out
  // loud: without it, tools that honour the header rather than the spec (the
  // DevTools protocol among them) read "—" as Latin-1.
  return result.toUIMessageStreamResponse({
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Content-Encoding': 'Identity',
      'X-DevSprint-Model': label,
      'X-DevSprint-Tools': toolSource,
      ...(turnTracer ? { 'X-DevSprint-Trace': turnTracer.traceId } : {}),
    },
    // Flushed here rather than from the agent's own `onFinish`, which fires
    // while the root `ai.streamText` span is still open — exporting then sent
    // seven spans all pointing at a parent that was never sent with them. This
    // callback runs once the UI stream is genuinely finished.
    //
    // The response *is* the stream, so this cannot be awaited inside the
    // handler; it rides the same `waitUntil` a cancelled deployment uses to
    // record itself once the request is over (ADR-0013, ADR-0015).
    // `originalMessages` is required alongside this callback: without it the
    // stream cannot reconstruct a response that *continues* an existing
    // assistant message, which is exactly what an approval resume is — it
    // throws "No tool invocation found for tool call ID" instead.
    ...(turnTracer
      ? {
          originalMessages: uiMessages,
          onFinish: () => waitUntil(turnTracer.flush()),
        }
      : {}),
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
