import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import { secureHeaders } from 'hono/secure-headers'
import {
  convertToModelMessages,
  validateUIMessages,
  type InferUITools,
  type UIDataTypes,
  type UIMessage,
} from 'ai'
import { API_ROUTES, trimChatHistory } from '@devsprint/shared'
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
import {
  dropUnusableApprovals,
  hasTooManyApprovals,
  resolveApprovalSecret,
  settleApprovals,
} from './agent/approvals'
import {
  chatRequestRefusal,
  MAX_CHAT_BODY_BYTES,
  stripUserProviderMetadata,
} from './agent/request-bounds'
import { createTurnTracer, resolveTracingConfig } from './agent/tracing'
import {
  BUDGET_REACHED_MESSAGE,
  limitMessage,
  messageOnlyResponse,
  RATE_LIMITED_MESSAGE,
  rateLimitKey,
  RESET_RETRY_AFTER_SECONDS,
  resolveDailyTokenCap,
  resolveResetCooldownMs,
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

// Hono's defaults, outermost so a refusal or a 404 carries them too (ADR-0025).
// `Cross-Origin-Resource-Policy: same-origin` only applies to no-cors requests,
// and the SPA's are all CORS-mode fetches, which the browser suite proves on
// every call it makes from another port. A page's <img> or <script> gets refused.
app.use('*', secureHeaders())

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

/**
 * CORS alone never refuses anything: a hostile page can still send a simple
 * POST and only loses the right to read the answer, while the write lands and
 * the chat turn spends tokens against its visitor's IP. Browsers always send
 * `Origin` on a cross-origin POST, and a page can't forge it, so that is what
 * this reads. A sandboxed frame sends `Origin: null`, which matches nothing.
 *
 * No `Origin` still passes. The board is open by design (ADR-0014), and curl and
 * scripts aren't browsers, so they could send any header anyway. This takes away
 * a free ride on visitors' browsers and is not access control.
 */
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin')
  if (c.req.method === 'POST' && origin && !corsOriginMatcher(c.env.CORS_ORIGIN)(origin)) {
    console.warn(JSON.stringify({ event: 'foreign-origin-refused', path: c.req.path }))
    return c.json(
      {
        ok: false as const,
        error: {
          code: 'FORBIDDEN_ORIGIN',
          message: 'This origin may not write to the demo board.',
        },
      },
      403,
    )
  }
  await next()
})

/**
 * A per-IP throttle on undo and cancel, the board writes that skip the model.
 * Before it, only the chat route was limited, so a loop could call them as
 * fast as the network allowed (ADR-0024). The looser per-location accounting
 * is fine here for the same reason it is on chat (ADR-0016): the job is to
 * stop a script, not to count precisely. The cancel token and the undo
 * record are what actually protect other visitors; this keeps one client
 * from hammering the Durable Object while they say no.
 *
 * Reset is not on it. Its whole-board cooldown is stricter than any per-IP
 * limit, and the e2e suite resets before every test, faster than a sane
 * limit would allow.
 */
const writeLimit = createMiddleware<{ Bindings: AppEnv }>(async (c, next) => {
  // Typed `| undefined` for the same reason as the chat limiter below.
  const limiter: RateLimitBinding | undefined = c.env.WRITE_RATE_LIMIT
  const clientKey = rateLimitKey(c.req.raw)
  if (limiter && clientKey !== undefined) {
    const { success } = await limiter.limit({ key: clientKey })
    if (!success) {
      console.warn(JSON.stringify({ event: 'write-rate-limited', path: c.req.path }))
      return c.json(
        {
          ok: false as const,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many changes in a short time. Try again in a minute.',
          },
        },
        429,
        { 'Retry-After': '60' },
      )
    }
  }
  await next()
})

app.get('/api/health', (c) => c.json({ ok: true }))

app.get(API_ROUTES.workspace, async (c) => c.json(await workspaceOf(c.env).snapshot()))

/**
 * Restores the seed. The demo is a mock workspace that approved writes mutate,
 * so both the "Reset demo" affordance in docs/wireframes.md §1 and the browser
 * tests need a way back to a known board. Independent of the workspace
 * Durable Object's own daily reset alarm (ADR-0014) — this is the manual
 * trigger for the same effect, not something the alarm supersedes.
 *
 * One reset per cooldown for the whole board, not per client: a reset loop
 * from many addresses would otherwise keep the board at its seed and wipe
 * every visitor's approved writes as they land (ADR-0024).
 */
app.post(API_ROUTES.workspaceReset, async (c) => {
  const result = await workspaceOf(c.env).requestReset({
    cooldownMs: resolveResetCooldownMs(c.env.RESET_COOLDOWN_SECONDS),
  })
  if (result.ok) return c.json(result.data)
  return c.json(result, 429, { 'Retry-After': String(RESET_RETRY_AFTER_SECONDS) })
})

/**
 * Undoes one approved board write — an approval card's Undo button.
 *
 * The body names the change and nothing else: `{ changeId }`, the id the
 * write's own result carried. What to put back comes from the workspace's
 * record of that write, taken when it landed (workspace/changes.ts), so a
 * client cannot use this to write arbitrary state — at most it can reverse a
 * write that really happened, once, while it is still the latest standing
 * write to that issue. Open for the same reason reset is (see the README): it is a
 * person's action on the shared demo board, not something the agent can reach.
 *
 * The copilot's transcript never hears about it. That is fine, because the
 * agent re-reads the board through its tools before it answers.
 */
app.post(API_ROUTES.workspaceUndo, writeLimit, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return undoInvalid(c, 'Request body must be JSON.')
  }
  const changeId =
    typeof body === 'object' && body !== null && 'changeId' in body ? body.changeId : undefined
  if (typeof changeId !== 'string') return undoInvalid(c, '`changeId` must be a string.')

  const result = await workspaceOf(c.env).undoChange({ changeId })
  if (!result.ok) {
    console.warn(JSON.stringify({ event: 'undo-refused', code: result.error.code }))
    // Refused because the board has moved on, not because the request was
    // wrong — a 409, like a cancel that arrives after the run settled.
    return c.json(result, result.error.code === 'UNDO_CONFLICT' ? 409 : 400)
  }
  // The same one-JSON-line record an agent step leaves, so an undo shows up in
  // the log beside the write it reversed.
  const { tool, issueKey, outcome } = result.data
  console.log(JSON.stringify({ event: 'undo', changeId, tool, issueKey, outcome }))
  return c.json(result)
})

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
 *
 * The body is `{ cancelToken }`, the token the run's own stream frames carry.
 * The board lists every deployment's id, so an id alone let anyone stop
 * anyone's run (ADR-0024); a wrong or missing token is
 * answered like an unknown id.
 */
app.post(API_ROUTES.deploymentCancel, writeLimit, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return undoInvalid(c, 'Request body must be JSON.')
  }
  const cancelToken =
    typeof body === 'object' && body !== null && 'cancelToken' in body
      ? body.cancelToken
      : undefined
  if (typeof cancelToken !== 'string') return undoInvalid(c, '`cancelToken` must be a string.')

  const result = await workspaceOf(c.env).cancelDeployment({
    deploymentId: c.req.param('id'),
    cancelToken,
  })
  if (result.ok) return c.json(result)
  // A run that already finished is a conflict, not a missing one — saying 200
  // here would tell the user their cancel landed when the release had shipped.
  return c.json(result, result.error.code === 'DEPLOY_ALREADY_SETTLED' ? 409 : 404)
})

/**
 * The undo and cancel routes answer in the `ToolResult` envelope the SPA reads
 * every outcome through, so a refused body still carries `ok: false` and its
 * code.
 */
function undoInvalid(c: Context<{ Bindings: AppEnv }>, message: string) {
  return c.json({ ok: false as const, error: { code: 'INVALID_INPUT', message } }, 400)
}

function invalidInput(c: Context<{ Bindings: AppEnv }>, message: string) {
  return c.json({ error: { code: 'INVALID_INPUT', message } }, 400)
}

/**
 * Reads a body with no Content-Length as far as the limit and no further, so a
 * chunked request cannot slip past the way it would past a header check.
 */
const chatBodyLimit = bodyLimit({
  maxSize: MAX_CHAT_BODY_BYTES,
  onError: (c) =>
    c.json({ error: { code: 'INVALID_INPUT', message: 'The request is too large.' } }, 413),
})

app.post(API_ROUTES.chat, chatBodyLimit, async (c) => {
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
  const refusal = chatRequestRefusal(messages)
  if (refusal !== undefined) return invalidInput(c, refusal)

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
      return messageOnlyResponse(limitMessage(RATE_LIMITED_MESSAGE, messages), {
        'X-DevSprint-Limit': 'rate',
      })
    }
  }

  const { tools, source: toolSource } = await buildTools(c.env, workspace, waitUntil)

  let uiMessages: ChatUIMessage[]
  try {
    uiMessages = await validateUIMessages<ChatUIMessage>({ messages, tools })
  } catch (error) {
    // The validator's text quotes the messages it rejected, so it stays out of
    // the response and only a short piece of it reaches the log.
    const { name, message } = describeError(error)
    console.warn(
      JSON.stringify({ event: 'invalid-ui-messages', name, message: message.slice(0, 200) }),
    )
    return invalidInput(c, 'Invalid UI messages.')
  }
  // Before settling, so what gets spent is read from the array the model will see.
  uiMessages = stripUserProviderMetadata(trimChatHistory(uiMessages))
  if (hasTooManyApprovals(uiMessages)) {
    return invalidInput(c, 'Too many approvals in one request.')
  }

  let resolved
  try {
    resolved = resolveModel(c.env)
  } catch (error) {
    if (error instanceof ModelConfigError) {
      // Names the missing secret, which is for the operator and not the visitor.
      console.error(JSON.stringify({ event: 'model-not-configured', error: error.message }))
      return c.json(
        { error: { code: 'MODEL_NOT_CONFIGURED', message: 'The model is not configured.' } },
        503,
      )
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
      return messageOnlyResponse(limitMessage(BUDGET_REACHED_MESSAGE, messages), {
        'X-DevSprint-Model': label,
        'X-DevSprint-Limit': 'budget',
      })
    }
  }

  // An approval that has already been acted on is downgraded to a denial rather
  // than executed again. The SDK's signature stops forgery but carries no nonce,
  // so a captured approval would otherwise replay indefinitely (ADR-0003 asks
  // for both to be covered). The ledger this checks against lives in the
  // workspace, not this isolate (ADR-0014), so the guarantee holds across
  // restarts and across whichever isolate a later request lands on.
  //
  // Down here, after every check that can refuse the turn, so an approval is
  // spent only by a turn that will act on it. Spent earlier, a press refused by
  // the budget would read as a replay once the budget came back.
  const messagesForTurn = dropUnusableApprovals(uiMessages)
  const { replayed } = await settleApprovals(messagesForTurn, workspace)
  if (replayed > 0) {
    console.warn(JSON.stringify({ event: 'approval-replay-blocked', count: replayed }))
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
    // Spend is recorded after each step, on `waitUntil`, so a turn stopped
    // halfway still counts the steps it took.
    ...(dailyCap !== undefined && label !== 'mock'
      ? {
          onUsage: (tokens: number) => waitUntil(workspace.recordModelUsage(tokens)),
          // Concurrent turns all pass the check above before any has recorded
          // spend, so each re-reads it between steps. Each can still overshoot by
          // about a step, and a read can miss a write `waitUntil` has not landed.
          shouldStop: async () => (await workspace.modelUsage()).tokens >= dailyCap,
        }
      : {}),
  })

  // The request signal is what makes the composer's Stop button real: aborting
  // the fetch ends the agent loop server-side instead of leaving it running.
  const result = await agent.stream({
    // A turn the user stopped leaves an assistant tool call with no result.
    // Without this the NEXT message throws MessageConversionError and the chat
    // is wedged until reload — pruning the dangling call is what lets the
    // conversation continue after Stop.
    messages: await convertToModelMessages(messagesForTurn, {
      tools,
      ignoreIncompleteToolCalls: true,
    }),
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
          originalMessages: messagesForTurn,
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
