import { describe, expect, it } from 'vitest'
import { APICallError, RetryError } from 'ai'
import { describeError, toClientErrorMessage } from './errors'

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: `provider responded ${statusCode}`,
    url: 'https://provider.example/v1/chat?key=sk-secret-value',
    requestBodyValues: { messages: ['confidential prompt'] },
    responseBody: '{"error":"rate limit reached for org_123"}',
    statusCode,
    isRetryable: statusCode === 429,
  })
}

/** `streamText` retries the model call, so a repeated 429 arrives wrapped. */
function retryWrapped(...errors: unknown[]): RetryError {
  return new RetryError({
    message: 'Failed after 2 attempts',
    reason: 'maxRetriesExceeded',
    errors,
  })
}

describe('toClientErrorMessage', () => {
  it('shows the demo-quota wording for a bare 429', () => {
    expect(toClientErrorMessage(apiError(429))).toMatch(/quota is exhausted/)
  })

  it('still shows it when the SDK wraps the 429 in a RetryError', () => {
    expect(toClientErrorMessage(retryWrapped(apiError(429), apiError(429)))).toMatch(
      /quota is exhausted/,
    )
  })

  it('falls back to the generic message for other failures', () => {
    expect(toClientErrorMessage(apiError(401))).toBe(
      "The copilot hit a model error and couldn't finish. Send your message again.",
    )
    expect(toClientErrorMessage(retryWrapped(apiError(500)))).toBe(
      "The copilot hit a model error and couldn't finish. Send your message again.",
    )
    expect(toClientErrorMessage(new Error('boom'))).toBe(
      "The copilot hit a model error and couldn't finish. Send your message again.",
    )
  })

  it('never leaks the key, the request body or the provider payload', () => {
    for (const error of [apiError(429), apiError(500), retryWrapped(apiError(429))]) {
      const message = toClientErrorMessage(error)
      expect(message).not.toContain('sk-secret-value')
      expect(message).not.toContain('confidential prompt')
      expect(message).not.toContain('org_123')
      expect(message).not.toContain('provider.example')
    }
  })
})

describe('describeError', () => {
  it('keeps the status code of a wrapped provider error for the server log', () => {
    expect(describeError(retryWrapped(apiError(429)))).toMatchObject({ statusCode: 429 })
    expect(describeError(apiError(503))).toMatchObject({ statusCode: 503 })
  })

  it('logs name and message only, never the url or response body', () => {
    const described = describeError(apiError(429))
    expect(JSON.stringify(described)).not.toContain('sk-secret-value')
    expect(JSON.stringify(described)).not.toContain('org_123')
    expect(described.name).toBe('AI_APICallError')
  })

  it('handles plain errors and non-errors', () => {
    expect(describeError(new TypeError('bad'))).toEqual({ name: 'TypeError', message: 'bad' })
    expect(describeError('oops')).toEqual({ name: 'UnknownError', message: 'oops' })
  })
})
