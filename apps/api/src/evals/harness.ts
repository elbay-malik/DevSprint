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

type MessagePart = Record<string, unknown> & { type: string }

/**
 * The assistant message for one user step, built the way the SPA's chat state
 * builds it: every round's chunks update the same message, so a write approved
 * in round one comes back in round two as a finished call with its result,
 * not as an approval still waiting to run.
 *
 * Rebuilding the message from each round's chunks alone lost that. The earlier
 * round's approval was sent again as answered-but-not-run, the server's
 * single-use ledger rightly refused it as a replay, and the turn failed with a
 * missing tool result. A model that asks for one write per round, as the live
 * one does, therefore always stopped after two approvals (ADR-0021's
 * 2026-11-09 correction). Each round's reads went missing the same way, so
 * the model listed the issues again every round.
 */
class AssistantMessage {
  private readonly parts: MessagePart[] = []

  constructor(
    private readonly id: string,
    private readonly names: Map<string, string>,
  ) {}

  private toolPart(toolCallId: string): MessagePart | undefined {
    return this.parts.find((part) => part.toolCallId === toolCallId)
  }

  /** Applies one round's stream, as the SPA's chat state does. */
  apply(chunks: EvalChunk[]): void {
    for (const chunk of chunks) {
      const id = chunk.toolCallId
      switch (chunk.type) {
        case 'start-step':
          this.parts.push({ type: 'step-start' })
          break
        case 'tool-input-available':
          if (id === undefined || this.toolPart(id) !== undefined) break
          this.parts.push({
            type: `tool-${this.names.get(id) ?? chunk.toolName ?? ''}`,
            toolCallId: id,
            state: 'input-available',
            input: chunk.input ?? {},
          })
          break
        case 'tool-approval-request': {
          const part = id === undefined ? undefined : this.toolPart(id)
          if (part === undefined) break
          part.state = 'approval-requested'
          part.approval = { id: chunk.approvalId ?? '', signature: chunk.signature }
          break
        }
        case 'tool-output-available': {
          const part = id === undefined ? undefined : this.toolPart(id)
          if (part === undefined) break
          part.state = 'output-available'
          part.output = chunk.output
          break
        }
        case 'tool-output-error': {
          const part = id === undefined ? undefined : this.toolPart(id)
          if (part === undefined) break
          part.state = 'output-error'
          part.errorText = chunk.errorText
          break
        }
        case 'tool-output-denied': {
          const part = id === undefined ? undefined : this.toolPart(id)
          if (part !== undefined) part.state = 'output-denied'
          break
        }
        case 'text-delta': {
          const last = this.parts.at(-1)
          if (last?.type === 'text') last.text = `${String(last.text)}${chunk.delta ?? ''}`
          else this.parts.push({ type: 'text', text: chunk.delta ?? '' })
          break
        }
      }
    }
  }

  /**
   * Answers every open card, the same shape `addToolApprovalResponse` produces,
   * signature included. Resending the message is what resumes the turn.
   */
  answer(
    decide: (approval: { toolName: string; input: Record<string, unknown> }) => ApprovalDecision,
  ): void {
    for (const part of this.parts) {
      if (part.state !== 'approval-requested') continue
      const decision = decide({
        toolName: part.type.slice('tool-'.length),
        input: (part.input ?? {}) as Record<string, unknown>,
      })
      const asked = part.approval as { id: string; signature?: string }
      part.state = 'approval-responded'
      part.approval = {
        id: asked.id,
        approved: decision.approved,
        ...(decision.reason === undefined ? {} : { reason: decision.reason }),
        signature: asked.signature,
      }
    }
  }

  /** The message to send while the step is still being answered. */
  toJSON() {
    return { id: this.id, role: 'assistant', parts: structuredClone(this.parts) }
  }

  /**
   * The message as the next step sees it. A call still waiting for an answer
   * is left out: the SPA holds the composer until every card is answered, so a
   * real next message never follows one.
   */
  settled() {
    const waiting = new Set(['input-available', 'approval-requested', 'approval-responded'])
    return {
      id: this.id,
      role: 'assistant',
      parts: structuredClone(this.parts.filter((part) => !waiting.has(String(part.state)))),
    }
  }
}

/** More rounds than any scenario needs (S-B has five writes); a bound, not a target. */
const MAX_APPROVAL_ROUNDS = 8

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

    const message = new AssistantMessage(`a${index}`, names)
    const asked = await post()
    turns.push(asked)
    message.apply(asked.chunks)

    // Answer the cards and resume, the way the SPA does, and keep doing it
    // while the resumed turn raises more. A live model may ask for writes one
    // at a time, and the SPA simply shows the next card.
    let pending = asked
    for (let round = 1; pending.approvals.length > 0 && step.decide !== undefined; round += 1) {
      message.answer(step.decide)
      history.push(message.toJSON())
      pending = await post()
      turns.push(pending)
      history.pop()
      message.apply(pending.chunks)
      if (round >= MAX_APPROVAL_ROUNDS) break
    }

    // The next step has to see what this one did: "Looks good, save it"
    // carries no version and no markdown; it means the draft this turn made.
    history.push(message.settled())
  }

  return {
    turns,
    trajectory: turns.flatMap((turn) => turn.toolCalls.map((call) => call.name)),
    store: workspace.store,
  }
}
