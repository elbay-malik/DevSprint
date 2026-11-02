import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelEnv } from './model'
import { DEFAULT_GROQ_MODEL, ModelConfigError, resolveModel } from './model'

const base: ModelEnv = {}

describe('resolveModel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('uses Groq when its key is set', () => {
    expect(resolveModel({ ...base, GROQ_API_KEY: 'g' }).label).toBe(`groq:${DEFAULT_GROQ_MODEL}`)
  })

  it('honours a model id override', () => {
    const { label } = resolveModel({ ...base, GROQ_API_KEY: 'g', GROQ_MODEL: 'other/model' })
    expect(label).toBe('groq:other/model')
  })

  it('ignores a Google key left behind, so it can never carry a chat (ADR-0026)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const leftover = { ...base, GOOGLE_GENERATIVE_AI_API_KEY: 'k' } as ModelEnv
    expect(resolveModel(leftover).label).toBe('mock')
    expect(resolveModel({ ...leftover, GROQ_API_KEY: 'g' }).label).toBe(
      `groq:${DEFAULT_GROQ_MODEL}`,
    )
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
