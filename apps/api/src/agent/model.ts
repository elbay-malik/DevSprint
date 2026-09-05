/**
 * Model routing per ADR-0005: Groq `llama-3.3-70b-versatile` primary, Gemini
 * Flash fallback, selected from the Worker env. With no keys at all the
 * scripted mock keeps local dev and CI running end-to-end. API keys are read
 * here and passed straight to the provider factories — never logged.
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { APICallError, type LanguageModel } from 'ai'
import type { AppEnv } from '../env'

/**
 * Only the model settings — routing has no business reading the workspace
 * binding or the approval secret.
 */
export type ModelEnv = Pick<
  AppEnv,
  'MODEL_PROVIDER' | 'GROQ_API_KEY' | 'GOOGLE_GENERATIVE_AI_API_KEY' | 'GROQ_MODEL' | 'GEMINI_MODEL'
>
import { withFallback } from './fallback-model'
import { createMockModel } from './mock-model'

export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

const MODEL_PROVIDERS = ['auto', 'groq', 'gemini', 'mock'] as const
export type ModelProvider = (typeof MODEL_PROVIDERS)[number]

export interface ResolvedModel {
  model: LanguageModel
  /** Human-readable route, e.g. `groq:llama-3.3-70b-versatile+fallback:gemini:gemini-2.5-flash`. */
  label: string
}

/** Misconfiguration the operator must fix; the chat route maps it to 503 MODEL_NOT_CONFIGURED. */
export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelConfigError'
  }
}

function isModelProvider(value: string): value is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(value)
}

/** `.dev.vars` lines like `GROQ_API_KEY=` arrive as empty strings; treat those as unset. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined
}

function requireKey(key: string | undefined, provider: 'groq' | 'gemini', envName: string): string {
  if (key === undefined) {
    throw new ModelConfigError(`MODEL_PROVIDER=${provider} requires ${envName} to be set.`)
  }
  return key
}

function logFallback(error: unknown): void {
  // Status only — provider error payloads may echo request details.
  const statusCode = APICallError.isInstance(error) ? error.statusCode : undefined
  console.warn(JSON.stringify({ event: 'model-fallback', from: 'groq', to: 'gemini', statusCode }))
}

let warnedMock = false

/** Warn once per isolate, not once per request. */
function mockModel(): ResolvedModel {
  if (!warnedMock) {
    warnedMock = true
    console.warn(
      'No GROQ_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY set — using the scripted mock model. ' +
        'Copy apps/api/.dev.vars.example to .dev.vars to talk to a real provider.',
    )
  }
  return { model: createMockModel(), label: 'mock' }
}

export function resolveModel(env: ModelEnv): ResolvedModel {
  const provider = nonEmpty(env.MODEL_PROVIDER) ?? 'auto'
  if (!isModelProvider(provider)) {
    throw new ModelConfigError(
      `MODEL_PROVIDER must be one of ${MODEL_PROVIDERS.join(', ')}; got '${provider}'.`,
    )
  }

  const groqKey = nonEmpty(env.GROQ_API_KEY)
  const geminiKey = nonEmpty(env.GOOGLE_GENERATIVE_AI_API_KEY)
  const groqId = nonEmpty(env.GROQ_MODEL) ?? DEFAULT_GROQ_MODEL
  const geminiId = nonEmpty(env.GEMINI_MODEL) ?? DEFAULT_GEMINI_MODEL
  const groq = (apiKey: string) => createGroq({ apiKey })(groqId)
  const gemini = (apiKey: string) => createGoogleGenerativeAI({ apiKey })(geminiId)

  switch (provider) {
    case 'mock':
      return { model: createMockModel(), label: 'mock' }
    case 'groq':
      return { model: groq(requireKey(groqKey, 'groq', 'GROQ_API_KEY')), label: `groq:${groqId}` }
    case 'gemini':
      return {
        model: gemini(requireKey(geminiKey, 'gemini', 'GOOGLE_GENERATIVE_AI_API_KEY')),
        label: `gemini:${geminiId}`,
      }
    case 'auto':
      if (groqKey !== undefined && geminiKey !== undefined) {
        return {
          model: withFallback({
            primary: groq(groqKey),
            fallback: gemini(geminiKey),
            onFallback: logFallback,
          }),
          label: `groq:${groqId}+fallback:gemini:${geminiId}`,
        }
      }
      if (groqKey !== undefined) return { model: groq(groqKey), label: `groq:${groqId}` }
      if (geminiKey !== undefined) return { model: gemini(geminiKey), label: `gemini:${geminiId}` }
      return mockModel()
  }
}
