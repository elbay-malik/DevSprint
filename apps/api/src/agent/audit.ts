import type { StreamTextOnStepFinishCallback, ToolSet } from 'ai'

/**
 * One JSON line per agent step. This is the observability floor named in
 * docs/roadmap.md ("keep the onStepFinish audit log"); Phase 10 replaces it
 * with OTLP export. Tool inputs are model-authored arguments, never secrets.
 */
export function createStepAuditLogger<TOOLS extends ToolSet>(
  label: string,
): StreamTextOnStepFinishCallback<TOOLS> {
  return (step) => {
    console.log(
      JSON.stringify({
        event: 'step',
        model: label,
        toolCalls: step.toolCalls.map((call) => ({ toolName: call.toolName, input: call.input })),
        finishReason: step.finishReason,
        usage: { inputTokens: step.usage.inputTokens, outputTokens: step.usage.outputTokens },
      }),
    )
  }
}
