import type { LanguageModelV3 } from './provider-types'

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
  charge: (tokens: number) => void
  refund: (tokens: number) => void
}

export interface SpendMeter {
  /** The model, charging each call as it goes. */
  wrap: (model: LanguageModelV3) => LanguageModelV3
  /** Replaces what the step was charged with what the provider says it cost. */
  settle: (tokens: number) => void
}

/**
 * Charges a model call as it starts and as it writes, then corrects that to the
 * real figure when the step finishes (ADR-0016's 2026-11-02 status note).
 *
 * The SDK only reports usage for a step that finishes. A client that disconnects
 * during the first call of every turn would otherwise never be charged, so
 * neither the share nor the cap would ever fire. The charge goes out before the
 * call, because nothing is sure to run after a client has gone.
 *
 * This is not a reservation. A step that finishes ends up on the provider's
 * figure, and only one that was cut off keeps the estimate.
 */
export function createSpendMeter({ charge, refund }: SpendMeterOptions): SpendMeter {
  let charged = 0
  const add = (tokens: number) => {
    charged += tokens
    charge(tokens)
  }
  return {
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
        add(estimate)
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
