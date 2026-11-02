import { stepCountIs, ToolLoopAgent, type LanguageModel } from 'ai'
import type { DevSprintTools } from './tools'

/**
 * Step budget for one turn. A step is one model call, so a chain of three tools
 * followed by the written answer costs four. Six leaves headroom for the
 * longest scripted scenario (S-A chains three tools) while still bounding a
 * runaway loop — an unbounded agent on a public demo is a quota incident.
 */
export const MAX_STEPS = 6

/**
 * Retries on one model call. Groq's free tier allows 8,000 tokens a minute and a
 * call here costs about 3,000, so the third call of a turn can be refused, and
 * Groq asks for a wait of seconds. With no second provider since ADR-0026, a
 * refusal ends the turn unless it is waited out. The SDK honours the Retry-After
 * and backs off otherwise, about 14 seconds at worst, and a refused call is
 * refunded (spend-meter.ts), so a retry costs the budget nothing.
 */
export const MAX_MODEL_RETRIES = 3

/**
 * Most a single model call may write. Without it a client can ask for an essay
 * and let the provider's default decide what that costs. Real release-notes
 * drafts fit well inside it. One at the 20,000-character limit would not, and
 * its tool call would be cut off and fail.
 */
export const MAX_OUTPUT_TOKENS = 4096

export interface CopilotAgentOptions {
  model: LanguageModel
  /** System prompt; the agent's own `instructions`, not a message in the history. */
  instructions: string
  tools: DevSprintTools
  /**
   * Signs each approval request so a forged one cannot execute a write. Always
   * supplied — see agent/approvals.ts for why running unsigned is not an option.
   */
  approvalSecret: string
  /**
   * Telemetry is a constructor setting on `ToolLoopAgent`, not a per-call one,
   * which suits a repo that already builds a fresh agent per request: the
   * tracer that belongs to this turn is handed over when the turn's agent is
   * made (ADR-0015).
   */
  tracer?: unknown
  /**
   * Called with each step's token usage as the step finishes. Used for the
   * daily spend cap (ADR-0016). Per step rather than once at the end, because
   * the SDK skips `onFinish` on an aborted turn, and a turn someone stopped has
   * still been billed for the steps it took. A step that never finishes is not
   * reported here at all, which is what spend-meter.ts is for.
   */
  onUsage?: (tokens: number) => void
  /**
   * Asked after each tool step whether to end the turn early. Used to stop a
   * turn once the day's budget has run out while it was going (ADR-0016).
   */
  shouldStop?: () => boolean | PromiseLike<boolean>
}

/**
 * The DevSprint copilot as an AI SDK `ToolLoopAgent`: it keeps calling tools and
 * feeding the results back until it can answer or the step budget runs out.
 *
 * A fresh agent per request is deliberate — `instructions` embed the workspace
 * snapshot, and the model route is resolved from the request environment.
 */
export function createCopilotAgent({
  model,
  instructions,
  tools,
  approvalSecret,
  tracer,
  onUsage,
  shouldStop,
}: CopilotAgentOptions) {
  return new ToolLoopAgent({
    model,
    instructions,
    tools,
    experimental_toolApprovalSecret: approvalSecret,
    // Refused up front in request-bounds.ts. The SDK only warns by default, so
    // this is what would stop one that got past that.
    allowSystemInMessages: false,
    ...(onUsage
      ? {
          onStepFinish: ({ usage }) =>
            onUsage((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
        }
      : {}),
    // Without a tracer the SDK uses its own no-op, so this is genuinely off
    // rather than merely quiet when tracing is not configured.
    ...(tracer
      ? {
          experimental_telemetry: {
            isEnabled: true,
            tracer: tracer as never,
            functionId: 'devsprint-turn',
          },
        }
      : {}),
    stopWhen: [stepCountIs(MAX_STEPS), ...(shouldStop ? [shouldStop] : [])],
    // On the final permitted step take the tools away, so the budget is spent
    // writing an answer instead of asking for one more tool. Without this a
    // model that keeps reaching for tools ends the turn on bare tool chips —
    // no prose, no error, nothing explaining why.
    prepareStep: ({ stepNumber }) => (stepNumber === MAX_STEPS - 1 ? { toolChoice: 'none' } : {}),
    // Low but not zero: the agent picks tools, it does not need to be creative.
    temperature: 0.2,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: MAX_MODEL_RETRIES,
  })
}

export type CopilotAgent = ReturnType<typeof createCopilotAgent>
