/**
 * Model routing per ADR-0005: Groq, selected from the Worker env. ADR-0026
 * removed the Gemini fallback. The Groq model is `openai/gpt-oss-120b`: Groq retired
 * `llama-3.3-70b-versatile`, and gpt-oss beat the one other tool-calling model
 * it offers on the live scenario evals (ADR-0021). With no keys at all the
 * scripted mock keeps local dev and CI running end-to-end. API keys are read
 * here and passed straight to the provider factories — never logged.
 */
import { createGroq } from '@ai-sdk/groq'
import type { AppEnv } from '../env'

/**
 * Only the model settings — routing has no business reading the workspace
 * binding or the approval secret.
 */
export type ModelEnv = Pick<AppEnv, 'MODEL_PROVIDER' | 'GROQ_API_KEY' | 'GROQ_MODEL'>
import { createMockModel } from './mock-model'
import type { LanguageModelV3 } from './provider-types'

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'

const MODEL_PROVIDERS = ['auto', 'groq', 'mock'] as const
export type ModelProvider = (typeof MODEL_PROVIDERS)[number]

export interface ResolvedModel {
  model: LanguageModelV3
  /** Human-readable route, e.g. `groq:openai/gpt-oss-120b`. */
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

let warnedMock = false

/** Warn once per isolate, not once per request. */
function mockModel(): ResolvedModel {
  if (!warnedMock) {
    warnedMock = true
    console.warn(
      'No GROQ_API_KEY set — using the scripted mock model. ' +
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
  const groqId = nonEmpty(env.GROQ_MODEL) ?? DEFAULT_GROQ_MODEL
  const groq = (apiKey: string) => createGroq({ apiKey })(groqId)

  switch (provider) {
    case 'mock':
      return { model: createMockModel(), label: 'mock' }
    case 'groq':
      if (groqKey === undefined) {
        throw new ModelConfigError('MODEL_PROVIDER=groq requires GROQ_API_KEY to be set.')
      }
      return { model: groq(groqKey), label: `groq:${groqId}` }
    case 'auto':
      return groqKey === undefined ? mockModel() : { model: groq(groqKey), label: `groq:${groqId}` }
  }
}
