import {
  APICallError,
  InvalidToolApprovalError,
  InvalidToolApprovalSignatureError,
  RetryError,
} from 'ai'

/**
 * The provider failure inside the SDK's retry wrapper. `streamText` retries the
 * model call, so a repeated 429 surfaces as `RetryError`, not `APICallError` —
 * without unwrapping, the quota branch below is unreachable in production.
 */
function rootCause(error: unknown): unknown {
  if (!RetryError.isInstance(error)) return error
  return error.lastError ?? error.errors.at(-1) ?? error
}

/**
 * Text the UI message stream carries to the client when the model call fails.
 * Deliberately generic: provider payloads can echo request details, and the
 * quota case gets the friendly wording ADR-0005 asks for.
 */
export function toClientErrorMessage(error: unknown): string {
  const cause = rootCause(error)
  if (APICallError.isInstance(cause) && cause.statusCode === 429) {
    return "The demo's model quota is exhausted right now — please try again in a minute."
  }
  // An approval the server would not accept is not a model failure, and
  // "please try again" is advice that cannot work — the same request carries
  // the same rejected approval. Say what actually happened instead.
  if (
    InvalidToolApprovalSignatureError.isInstance(cause) ||
    InvalidToolApprovalError.isInstance(cause)
  ) {
    return 'That approval could not be verified, so nothing was run. Ask again to get a fresh one.'
  }
  return 'The copilot hit a model error. Please try again.'
}

/** Server-log shape: name, message and status — no URL, headers or bodies. */
export function describeError(error: unknown): {
  name: string
  message: string
  statusCode?: number
} {
  const cause = rootCause(error)
  if (APICallError.isInstance(cause)) {
    return cause.statusCode === undefined
      ? { name: cause.name, message: cause.message }
      : { name: cause.name, message: cause.message, statusCode: cause.statusCode }
  }
  if (cause instanceof Error) return { name: cause.name, message: cause.message }
  return { name: 'UnknownError', message: String(cause) }
}
