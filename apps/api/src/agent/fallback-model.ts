import { APICallError } from 'ai'
import type { LanguageModelV3 } from './provider-types'

export interface FallbackOptions {
  primary: LanguageModelV3
  fallback: LanguageModelV3
  /** Called once per delegated call, with the primary's error. */
  onFallback?: (error: unknown) => void
}

/**
 * Quota, rate-limit and server-side failures move to the fallback provider;
 * anything else (bad key, bad request, network) is the caller's problem.
 */
export function shouldFallback(error: unknown): boolean {
  return (
    APICallError.isInstance(error) &&
    (error.isRetryable || error.statusCode === 429 || (error.statusCode ?? 0) >= 500)
  )
}

/**
 * Wraps two V3 models so `doGenerate`/`doStream` try `primary` and, when the
 * call itself fails with a retryable/quota error, delegate to `fallback`
 * (ADR-0005: Groq primary, Gemini Flash fallback). Only the initial call is
 * guarded — errors emitted after a stream has started are NOT caught, because
 * by then chunks may already have reached the client and a silent restart
 * would duplicate output.
 */
export function withFallback({ primary, fallback, onFallback }: FallbackOptions): LanguageModelV3 {
  const attempt = async <T>(run: (model: LanguageModelV3) => PromiseLike<T>): Promise<T> => {
    try {
      return await run(primary)
    } catch (error) {
      if (!shouldFallback(error)) throw error
      onFallback?.(error)
      return await run(fallback)
    }
  }

  return {
    specificationVersion: 'v3',
    provider: primary.provider,
    modelId: primary.modelId,
    get supportedUrls() {
      return primary.supportedUrls
    },
    doGenerate: (options) => attempt((model) => model.doGenerate(options)),
    doStream: (options) => attempt((model) => model.doStream(options)),
  }
}
