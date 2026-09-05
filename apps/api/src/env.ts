/**
 * Worker bindings. `Env` is the wrangler-generated global from
 * worker-configuration.d.ts (vars only). Secrets and optional overrides are
 * declared here as an intersection rather than `interface extends` so a future
 * `wrangler types` run that emits them as `string` stays assignable.
 *
 * Locally these come from apps/api/.dev.vars (see .dev.vars.example); in
 * production from `wrangler secret put`. None of them is a wrangler.jsonc var.
 */
export type AppEnv = Env & {
  /** Groq API key — primary provider (ADR-0005). */
  GROQ_API_KEY?: string
  /** Google Generative AI key — Gemini Flash fallback (ADR-0005). */
  GOOGLE_GENERATIVE_AI_API_KEY?: string
  /** 'auto' (default) | 'groq' | 'gemini' | 'mock' — see agent/model.ts. */
  MODEL_PROVIDER?: string
  GROQ_MODEL?: string
  GEMINI_MODEL?: string
}
