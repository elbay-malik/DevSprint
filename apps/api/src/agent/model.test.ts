import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APICallError } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import type { AppEnv } from '../env'
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL, ModelConfigError, resolveModel } from './model'
import { shouldFallback, withFallback } from './fallback-model'

const base: AppEnv = { CORS_ORIGIN: 'http://localhost:5173' }

function apiError(statusCode: number, isRetryable: boolean): APICallError {
  return new APICallError({
    message: `provider responded ${statusCode}`,
    url: 'https://provider.example/v1/chat',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  })
}

describe('resolveModel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('pairs Groq with the Gemini fallback when both keys are present (ADR-0005)', () => {
    const { label } = resolveModel({
      ...base,
      GROQ_API_KEY: 'g',
      GOOGLE_GENERATIVE_AI_API_KEY: 'k',
    })
    expect(label).toBe(`groq:${DEFAULT_GROQ_MODEL}+fallback:gemini:${DEFAULT_GEMINI_MODEL}`)
  })

  it('uses whichever single provider is configured', () => {
    expect(resolveModel({ ...base, GROQ_API_KEY: 'g' }).label).toBe(`groq:${DEFAULT_GROQ_MODEL}`)
    expect(resolveModel({ ...base, GOOGLE_GENERATIVE_AI_API_KEY: 'k' }).label).toBe(
      `gemini:${DEFAULT_GEMINI_MODEL}`,
    )
  })

  it('honours model id overrides', () => {
    const { label } = resolveModel({
      ...base,
      GROQ_API_KEY: 'g',
      GROQ_MODEL: 'openai/gpt-oss-120b',
      GEMINI_MODEL: 'gemini-3-flash-preview',
      GOOGLE_GENERATIVE_AI_API_KEY: 'k',
    })
    expect(label).toBe('groq:openai/gpt-oss-120b+fallback:gemini:gemini-3-flash-preview')
  })

  it('treats blank keys as unset and falls back to the scripted mock', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveModel({ ...base, GROQ_API_KEY: '   ' }).label).toBe('mock')
  })

  it('warns once per isolate when it degrades to the mock', async () => {
    vi.resetModules()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('./model')
    fresh.resolveModel(base)
    fresh.resolveModel(base)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('selects the mock explicitly without any key', () => {
    expect(resolveModel({ ...base, MODEL_PROVIDER: 'mock' }).label).toBe('mock')
  })

  it('refuses an explicitly requested provider whose key is missing', () => {
    expect(() => resolveModel({ ...base, MODEL_PROVIDER: 'groq' })).toThrow(ModelConfigError)
    expect(() => resolveModel({ ...base, MODEL_PROVIDER: 'gemini' })).toThrow(ModelConfigError)
    expect(() => resolveModel({ ...base, MODEL_PROVIDER: 'anthropic' })).toThrow(ModelConfigError)
  })

  it('never puts a key in the label', () => {
    const { label } = resolveModel({ ...base, GROQ_API_KEY: 'sk-secret-value' })
    expect(label).not.toContain('sk-secret-value')
  })
})

describe('shouldFallback', () => {
  it('covers quota, rate limit and server errors only', () => {
    expect(shouldFallback(apiError(429, false))).toBe(true)
    expect(shouldFallback(apiError(503, false))).toBe(true)
    expect(shouldFallback(apiError(408, true))).toBe(true)
    expect(shouldFallback(apiError(401, false))).toBe(false)
    expect(shouldFallback(apiError(400, false))).toBe(false)
    expect(shouldFallback(new Error('boom'))).toBe(false)
  })
})

describe('withFallback', () => {
  const streamResult = { stream: new ReadableStream() }

  it('delegates to the fallback on a quota error and reports it', async () => {
    const onFallback = vi.fn()
    const primary = new MockLanguageModelV3({
      doStream: () => Promise.reject(apiError(429, true)),
    })
    const fallback = new MockLanguageModelV3({ doStream: () => Promise.resolve(streamResult) })
    const model = withFallback({ primary, fallback, onFallback })

    await expect(model.doStream({ prompt: [] })).resolves.toBe(streamResult)
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(fallback.doStreamCalls).toHaveLength(1)
  })

  it('rethrows an auth error instead of burning the fallback quota', async () => {
    const fallback = new MockLanguageModelV3({ doStream: () => Promise.resolve(streamResult) })
    const model = withFallback({
      primary: new MockLanguageModelV3({ doStream: () => Promise.reject(apiError(401, false)) }),
      fallback,
    })

    await expect(model.doStream({ prompt: [] })).rejects.toThrow('provider responded 401')
    expect(fallback.doStreamCalls).toHaveLength(0)
  })

  it('leaves the fallback untouched on the happy path and keeps the primary identity', async () => {
    const fallback = new MockLanguageModelV3({ doStream: () => Promise.resolve(streamResult) })
    const primary = new MockLanguageModelV3({
      provider: 'groq',
      modelId: 'llama-3.3-70b-versatile',
      doStream: () => Promise.resolve(streamResult),
    })
    const model = withFallback({ primary, fallback })

    await expect(model.doStream({ prompt: [] })).resolves.toBe(streamResult)
    expect(fallback.doStreamCalls).toHaveLength(0)
    expect(model.provider).toBe('groq')
    expect(model.modelId).toBe('llama-3.3-70b-versatile')
  })
})
