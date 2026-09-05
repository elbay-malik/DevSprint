/**
 * LanguageModelV3 interfaces, derived from the `LanguageModel` union that `ai`
 * exports. `@ai-sdk/provider` is only a transitive dependency here (pnpm does
 * not expose it to this package) and `ai` does not re-export these types, so
 * we extract them rather than add a catalog entry for a types-only import.
 * Swap for `import type { … } from '@ai-sdk/provider'` if the package is ever
 * added as a direct dependency.
 */
import type { LanguageModel } from 'ai'

export type LanguageModelV3 = Extract<LanguageModel, { specificationVersion: 'v3' }>
export type LanguageModelV3CallOptions = Parameters<LanguageModelV3['doStream']>[0]
export type LanguageModelV3StreamResult = Awaited<ReturnType<LanguageModelV3['doStream']>>
export type LanguageModelV3GenerateResult = Awaited<ReturnType<LanguageModelV3['doGenerate']>>
export type LanguageModelV3StreamPart =
  LanguageModelV3StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never
export type LanguageModelV3Usage = Extract<LanguageModelV3StreamPart, { type: 'finish' }>['usage']
export type LanguageModelV3Prompt = LanguageModelV3CallOptions['prompt']
export type LanguageModelV3Message = LanguageModelV3Prompt[number]
