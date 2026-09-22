/**
 * The trajectory-eval harness for Phase 10 (ADR-0015).
 *
 * Each scenario in docs/demo-scenarios.md ends in "Eval assertions" — exact
 * tool-call order, "the denied write never mutates state", "the next call after
 * the error is `search_issues`". Those are claims about the *application*: its
 * gating, its ordering, its recovery. This runs a scenario through the real
 * `/api/chat` route and hands back what actually happened, so those claims can
 * be asserted rather than left as prose.
 *
 * It drives the route rather than the agent directly, deliberately: approval
 * gating, replay settling and the UI message stream all live in the route, and
 * a scenario that skipped them would be evaluating something the demo does not
 * do.
 *
 * Against the scripted mock this is deterministic and free, so it gates every
 * PR. That is also its honest limit: it proves the app honours a trajectory,
 * not that a real model elicits one — `modelProvider` is how you go and check
 * the latter, at the cost of quota and determinism.
 */
import app from '../index'
import type { WorkspaceStore } from '../workspace/store'
import { fakeWorkspaceBinding } from '../../test/workspace-binding'

export interface EvalChunk {
  type: string
  toolName?: string
  toolCallId?: string
  approvalId?: string
  signature?: string
  delta?: string
  input?: Record<string, unknown>
  output?: unknown
  [key: string]: unknown
}

export interface ApprovalDecision {
  approved: boolean
  reason?: string
}

export interface EvalTurn {
  /** Every tool the agent asked for, in the order it asked. */
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>
  /** Every approval the turn requested, in order. */
  approvals: Array<{ approvalId: string; toolCallId: string; toolName: string }>
  /** Tool results that actually came back — i.e. calls that really executed. */
  results: Array<{ name: string; output: unknown }>
  /** The assistant's written answer for this turn. */
  text: string
  chunks: EvalChunk[]
}

export interface ScenarioRun {
  /** Turns in order, so an assertion can talk about "after the error". */
  turns: EvalTurn[]
  /** Every tool call across the whole scenario, flattened — the trajectory. */
  trajectory: string[]
  /** The board as the scenario left it. */
  store: WorkspaceStore
}

function parseChunks(body: string): EvalChunk[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => JSON.parse(payload) as EvalChunk)
}

/**
 * Only `tool-input-available` carries the tool's name; the approval request and
 * the result that follow it are joined by `toolCallId` alone. Reading
 * `chunk.toolName` off those gives an empty string, which reads as a passing
 * assertion against `''` rather than a missing one.
 */
function collectNames(chunks: EvalChunk[], into: Map<string, string>): Map<string, string> {
  for (const chunk of chunks) {
    if (chunk.type === 'tool-input-available' && chunk.toolCallId !== undefined) {
      into.set(chunk.toolCallId, chunk.toolName ?? '')
    }
  }
  return into
}

/**
 * `names` is threaded across the whole scenario, not rebuilt per turn: a gated
 * call is announced in the turn that raises the card and only produces its
 * result in the turn that resumes, so the resumed turn has no announcement of
 * its own to read the name from.
 */
function summarize(chunks: EvalChunk[], names: Map<string, string>): EvalTurn {
  collectNames(chunks, names)

  const toolCalls = chunks
    .filter((chunk) => chunk.type === 'tool-input-available')
    .map((chunk) => ({ name: chunk.toolName ?? '', input: chunk.input ?? {} }))

  const approvals = chunks
    .filter((chunk) => chunk.type === 'tool-approval-request')
    .map((chunk) => ({
      approvalId: chunk.approvalId ?? '',
      toolCallId: chunk.toolCallId ?? '',
      toolName: names.get(chunk.toolCallId ?? '') ?? '',
    }))

  const results = chunks
    .filter((chunk) => chunk.type === 'tool-output-available')
    .map((chunk) => ({ name: names.get(chunk.toolCallId ?? '') ?? '', output: chunk.output }))

  const text = chunks
    .filter((chunk) => chunk.type === 'text-delta')
    .map((chunk) => chunk.delta ?? '')
    .join('')

  return { toolCalls, approvals, results, text, chunks }
}

/**
 * The assistant message the SPA holds once every card has been answered — the
 * same shape `addToolApprovalResponse` produces, signature included. Resending
 * it is what resumes the turn, so a scenario with gates needs this to get past
 * step one.
 */
function answeredAssistantMessage(
  chunks: EvalChunk[],
  decide: (approval: { toolName: string; input: Record<string, unknown> }) => ApprovalDecision,
  id: string,
) {
  const inputs = new Map<string, Record<string, unknown>>()
  const names = new Map<string, string>()
  for (const chunk of chunks) {
    if (chunk.type !== 'tool-input-available' || chunk.toolCallId === undefined) continue
    inputs.set(chunk.toolCallId, chunk.input ?? {})
    names.set(chunk.toolCallId, chunk.toolName ?? '')
  }

  const parts = chunks
    .filter((chunk) => chunk.type === 'tool-approval-request')
    .map((approval) => {
      const toolCallId = approval.toolCallId ?? ''
      const toolName = names.get(toolCallId) ?? ''
      const input = inputs.get(toolCallId) ?? {}
      const decision = decide({ toolName, input })
      return {
        type: `tool-${toolName}`,
        toolCallId,
        state: 'approval-responded',
        input,
        approval: {
          id: approval.approvalId ?? '',
          approved: decision.approved,
          ...(decision.reason === undefined ? {} : { reason: decision.reason }),
          signature: approval.signature,
        },
      }
    })

  return { id, role: 'assistant', parts: [{ type: 'step-start' }, ...parts] }
}

/**
 * The assistant message the SPA would hold after a turn finished: its tool
 * calls with their results, plus whatever it wrote. Without this the history
 * handed to the next turn contains only user text, and any step that refers
 * back to an earlier one ("save it", "yes, that one") has nothing to refer to.
 */
function completedAssistantMessage(chunks: EvalChunk[], id: string, names: Map<string, string>) {
  const inputs = new Map<string, Record<string, unknown>>()
  for (const chunk of chunks) {
    if (chunk.type === 'tool-input-available' && chunk.toolCallId !== undefined) {
      inputs.set(chunk.toolCallId, chunk.input ?? {})
    }
  }

  const parts: unknown[] = [{ type: 'step-start' }]
  for (const chunk of chunks) {
    if (chunk.type !== 'tool-output-available' || chunk.toolCallId === undefined) continue
    parts.push({
      type: `tool-${names.get(chunk.toolCallId) ?? ''}`,
      toolCallId: chunk.toolCallId,
      state: 'output-available',
      input: inputs.get(chunk.toolCallId) ?? {},
      output: chunk.output,
    })
  }

  const text = chunks
    .filter((chunk) => chunk.type === 'text-delta')
    .map((chunk) => chunk.delta ?? '')
    .join('')
  if (text.length > 0) parts.push({ type: 'text', text })

  return { id, role: 'assistant', parts }
}

export interface ScenarioStep {
  /** The user's verbatim prompt from docs/demo-scenarios.md. */
  prompt: string
  /**
   * How to answer each approval this step raises. Omit to leave them
   * unanswered, which is how a scenario asserts that nothing ran.
   */
  decide?: (approval: { toolName: string; input: Record<string, unknown> }) => ApprovalDecision
}

export interface RunScenarioOptions {
  steps: ScenarioStep[]
  /** Defaults to the scripted mock — deterministic, free, CI-safe. */
  modelProvider?: string
  /** Extra env, e.g. real provider keys when checking a live model. */
  env?: Record<string, unknown>
}

/**
 * Runs a scenario end to end and returns its trajectory.
 *
 * A step with approvals costs two requests: the first raises the cards, the
 * second resends the history with the answers — exactly what the SPA does, and
 * the only way the gated half of a scenario is reachable at all.
 */
export async function runScenario(options: RunScenarioOptions): Promise<ScenarioRun> {
  const workspace = fakeWorkspaceBinding()
  const env = {
    CORS_ORIGIN: 'http://localhost:5173',
    MODEL_PROVIDER: options.modelProvider ?? 'mock',
    WORKSPACE: workspace.binding,
    ...options.env,
  }

  const history: unknown[] = []
  const turns: EvalTurn[] = []
  const names = new Map<string, string>()

  const post = async (): Promise<EvalTurn> => {
    const res = await app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      },
      env,
    )
    return summarize(parseChunks(await res.text()), names)
  }

  for (const [index, step] of options.steps.entries()) {
    history.push({
      id: `u${index}`,
      role: 'user',
      parts: [{ type: 'text', text: step.prompt }],
    })

    const asked = await post()
    turns.push(asked)

    if (asked.approvals.length === 0 || step.decide === undefined) {
      // No gate to answer, so the turn is over — but the next turn still has
      // to be able to see what this one did. "Looks good, save it" carries no
      // version and no markdown; it means the draft the previous turn made.
      history.push(completedAssistantMessage(asked.chunks, `a${index}`, names))
      continue
    }

    // Answer the cards and resume, the way the SPA does.
    history.push(answeredAssistantMessage(asked.chunks, step.decide, `a${index}`))
    const resumed = await post()
    turns.push(resumed)
    history.push(completedAssistantMessage(resumed.chunks, `a${index}-resumed`, names))
  }

  return {
    turns,
    trajectory: turns.flatMap((turn) => turn.toolCalls.map((call) => call.name)),
    store: workspace.store,
  }
}
