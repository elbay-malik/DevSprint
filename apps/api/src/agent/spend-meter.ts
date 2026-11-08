import type { SpendLimit } from '@devsprint/shared/tools'
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from './provider-types'

/** Rough, and fine for that: only a step that never reports its usage keeps this. */
const CHARS_PER_TOKEN = 4

/**
 * How much written output builds up before it is charged. An answer that stops
 * sooner is left to its step's real figure, and a step cut off here goes
 * undercharged by no more than this. Up to about 8 writes for the longest call
 * `MAX_OUTPUT_TOKENS` allows, and none for most answers.
 */
const OUTPUT_CHARGE_CHARS = 2000

/**
 * The most a call is charged as it starts: about what one call can really cost,
 * Groq's 8,000 input tokens a minute (ADR-0021) plus `MAX_OUTPUT_TOKENS`. Counting
 * characters overstates a request the provider would turn down for its size, and
 * a call cut off before it reports keeps this charge. Revisit with the tier.
 */
export const MAX_CALL_ESTIMATE_TOKENS = 12_000

const toTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)

export interface SpendMeterOptions {
  /**
   * Checks the limits and, if neither has been reached, charges `tokens`, as one
   * step in the workspace (`admitModelCall`). Resolves to the limit that refused
   * the call, or undefined when it was admitted and charged.
   */
  admit: (tokens: number) => Promise<SpendLimit | undefined>
  charge: (tokens: number) => void
  refund: (tokens: number) => void
}

export interface SpendMeter {
  /** The model, admitting and charging each call as it goes. */
  wrap: (model: LanguageModelV3) => LanguageModelV3
  /** Replaces what the step was charged with what the provider says it cost. */
  settle: (tokens: number) => void
  /**
   * Settles once the turn's first call has been admitted or refused, with the
   * limit that refused it. Lets the route answer a refused first call with a
   * plain limit turn, the same as a refusal at the door. Also undefined when
   * the admission itself failed, since that error reaches the stream instead.
   */
  firstAdmission: Promise<SpendLimit | undefined>
  /** The limit that refused a call during this turn, if one did. */
  readonly refusedBy: SpendLimit | undefined
}

/**
 * What a refused call answers in place of the provider: a step with nothing in
 * it, which ends the turn cleanly because it asks for no tool. The route then
 * closes the turn with the limit's message. No usage, so the step settles on
 * nothing, which is what it cost.
 */
function refusedCall(): LanguageModelV3StreamResult {
  const parts: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'finish',
      finishReason: { unified: 'other', raw: undefined },
      usage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      },
    },
  ]
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      },
    }),
  }
}

/**
 * Admits a model call as it starts, charging its estimate in the same step, and
 * charges it again as it writes, then corrects that to the real figure when the
 * step finishes (ADR-0016's 2026-11-02 and 2026-11-08 status notes).
 *
 * The SDK only reports usage for a step that finishes. A client that disconnects
 * during the first call of every turn would otherwise never be charged, so
 * neither the share nor the cap would ever fire. The charge goes out before the
 * call, because nothing is sure to run after a client has gone.
 *
 * The opening charge is awaited, and it is also the check: the workspace decides
 * and records it together, so concurrent turns are admitted one at a time and
 * the provider is never called on a refused one. What is written afterwards is
 * charged without a check, since the call is already paid for by then.
 *
 * This is not a reservation. A step that finishes ends up on the provider's
 * figure, and only one that was cut off keeps the estimate.
 */
export function createSpendMeter({ admit, charge, refund }: SpendMeterOptions): SpendMeter {
  let charged = 0
  let refusedBy: SpendLimit | undefined
  let calls = 0
  let answerFirst: (limit: SpendLimit | undefined) => void = () => undefined
  const firstAdmission = new Promise<SpendLimit | undefined>((resolve) => {
    answerFirst = resolve
  })
  const add = (tokens: number) => {
    charged += tokens
    charge(tokens)
  }
  return {
    firstAdmission,
    get refusedBy() {
      return refusedBy
    },
    wrap: (model) => ({
      specificationVersion: 'v3',
      provider: model.provider,
      modelId: model.modelId,
      get supportedUrls() {
        return model.supportedUrls
      },
      // `ToolLoopAgent.stream` never calls this, and a finished call has a real figure.
      doGenerate: (options) => model.doGenerate(options),
      doStream: async (options) => {
        const estimate = Math.min(
          toTokens(JSON.stringify([options.prompt, options.tools]).length),
          MAX_CALL_ESTIMATE_TOKENS,
        )
        const first = calls === 0
        calls += 1
        let refused: SpendLimit | undefined
        try {
          refused = await admit(estimate)
        } catch (error) {
          if (first) answerFirst(undefined)
          throw error
        }
        if (first) answerFirst(refused)
        if (refused !== undefined) {
          refusedBy = refused
          return refusedCall()
        }
        charged += estimate
        let result
        try {
          result = await model.doStream(options)
        } catch (error) {
          // The provider turned the call down, so nothing was spent. The SDK's
          // retry comes back through here and is charged again. A client that
          // left mid-call is different: the provider may already have the prompt.
          if (!options.abortSignal?.aborted) {
            charged -= estimate
            refund(estimate)
          }
          throw error
        }
        let written = 0
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              transform(part, controller) {
                if (
                  part.type === 'text-delta' ||
                  part.type === 'reasoning-delta' ||
                  part.type === 'tool-input-delta'
                ) {
                  written += part.delta.length
                  if (written >= OUTPUT_CHARGE_CHARS) {
                    add(toTokens(written))
                    written = 0
                  }
                }
                controller.enqueue(part)
              },
            }),
          ),
        }
      },
    }),
    settle: (tokens) => {
      // No figure means the provider did not say, not that the step was free, so
      // the estimate stands.
      if (!(tokens > 0)) {
        charged = 0
        return
      }
      const owed = tokens - charged
      charged = 0
      if (owed > 0) charge(owed)
      else if (owed < 0) refund(-owed)
    },
  }
}
