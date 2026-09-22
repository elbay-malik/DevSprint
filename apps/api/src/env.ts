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
  /**
   * Signs tool approvals so a forged one cannot execute a write. Unset falls
   * back to a random per-isolate secret — fine locally, not for a deploy.
   */
  TOOL_APPROVAL_SECRET?: string
  /**
   * Langfuse credentials. Both keys must be present for tracing to install at
   * all — with neither, the Worker runs with no network and no account, the
   * same way the model routing falls back to its scripted mock (ADR-0015).
   */
  LANGFUSE_PUBLIC_KEY?: string
  LANGFUSE_SECRET_KEY?: string
  /** Defaults to https://cloud.langfuse.com; set for the US/EU/self-hosted region. */
  LANGFUSE_HOST?: string
  /** Tags traces with the environment they came from, e.g. `production`. */
  DEVSPRINT_ENV?: string
}
