import { stepCountIs, ToolLoopAgent, type LanguageModel } from 'ai'
import type { DevSprintTools } from './tools'

/**
 * Step budget for one turn. A step is one model call, so a chain of three tools
 * followed by the written answer costs four. Six leaves headroom for the
 * longest scripted scenario (S-A chains three tools) while still bounding a
 * runaway loop — an unbounded agent on a public demo is a quota incident.
 */
export const MAX_STEPS = 6

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
}: CopilotAgentOptions) {
  return new ToolLoopAgent({
    model,
    instructions,
    tools,
    experimental_toolApprovalSecret: approvalSecret,
    stopWhen: stepCountIs(MAX_STEPS),
    // On the final permitted step take the tools away, so the budget is spent
    // writing an answer instead of asking for one more tool. Without this a
    // model that keeps reaching for tools ends the turn on bare tool chips —
    // no prose, no error, nothing explaining why.
    prepareStep: ({ stepNumber }) => (stepNumber === MAX_STEPS - 1 ? { toolChoice: 'none' } : {}),
    // Low but not zero: the agent picks tools, it does not need to be creative.
    temperature: 0.2,
    maxRetries: 1,
  })
}

export type CopilotAgent = ReturnType<typeof createCopilotAgent>
