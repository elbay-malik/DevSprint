/**
 * The environment `pnpm ci:local` gives each step. It lives apart from
 * ci-local.ts, which runs on import, so the tests can load it.
 */

/**
 * Credentials on a workstation that no step in `checks` or `e2e` needs. CF_* are
 * the old names for CLOUDFLARE_*, which wrangler still reads.
 */
const CREDENTIAL =
  /^(CLOUDFLARE_|CF_|GROQ_|GOOGLE_|LANGFUSE_)|^(GH|GITHUB)_TOKEN$|^WRANGLER_\w+_TOKEN$/

/** The given environment minus credentials, with CI=1 as on a runner. */
export function ciEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = Object.entries(env).filter(([name]) => !CREDENTIAL.test(name))
  return { ...Object.fromEntries(kept), CI: '1' }
}
