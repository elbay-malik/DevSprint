/**
 * The decisions scripts/deploy.ts makes before it ships anything, as pure
 * functions, so a test can cover every answer without a wrangler or a remote.
 */

export interface GitState {
  /** Tracked files differ from HEAD. Untracked files do not count. */
  dirty: boolean
  /** `git branch --show-current`: empty on a detached HEAD. */
  branch: string
  head: string
  originMain: string
}

/** Why this checkout may not deploy from a laptop, or undefined if it may. */
export function deployRefusal(state: GitState): string | undefined {
  const reasons: string[] = []
  if (state.branch !== 'main') {
    reasons.push(`on ${state.branch ? `branch ${state.branch}` : 'a detached HEAD'}, not main`)
  }
  if (state.dirty) reasons.push('tracked files have uncommitted changes')
  if (state.head !== state.originMain) {
    reasons.push(`HEAD is ${state.head}, but origin/main is ${state.originMain}`)
  }
  return reasons.length > 0 ? reasons.join('; ') : undefined
}

const GROQ = 'GROQ_API_KEY'
const GEMINI = 'GOOGLE_GENERATIVE_AI_API_KEY'

/**
 * A MODEL_PROVIDER that apps/api/src/agent/model.ts would reject on every chat.
 * Unlike a missing key, no secret set after the deploy can fix it, so a first
 * deploy refuses it too.
 */
export function unknownProvider(provider: string): string | undefined {
  return ['auto', 'groq', 'gemini', 'mock'].includes(provider)
    ? undefined
    : `MODEL_PROVIDER='${provider}' is not one the api knows`
}

/**
 * What the api lacks to run MODEL_PROVIDER, or undefined if it has it. `auto`
 * with neither key does not fail: apps/api/src/agent/model.ts falls back to the
 * scripted mock, which is right for a fresh clone and wrong for the live demo.
 */
export function missingProviderSecret(
  provider: string,
  secrets: ReadonlySet<string>,
): string | undefined {
  switch (provider) {
    case 'mock':
      return undefined
    case 'groq':
      return secrets.has(GROQ) ? undefined : GROQ
    case 'gemini':
      return secrets.has(GEMINI) ? undefined : GEMINI
    case 'auto':
      return secrets.has(GROQ) || secrets.has(GEMINI) ? undefined : `${GROQ} or ${GEMINI}`
    default:
      return undefined
  }
}

export type App = 'api' | 'mcp-issues' | 'web'

/**
 * What to run by hand after a failed deploy, for the Workers this run shipped.
 * Only printed: the Workers call each other, so rolling one back on its own can
 * leave a mismatched pair (ADR-0019), and which ones go back together is a call
 * for whoever reads the failure. Last shipped comes first, so the api goes back
 * before the MCP entrypoint it may bind.
 */
export function rollbackHints(shipped: readonly App[]): string[] {
  const apps = (['web', 'api', 'mcp-issues'] as const).filter((app) => shipped.includes(app))
  if (apps.length === 0) return []
  return [
    '',
    'Nothing was rolled back. These Workers now run this deploy; to go back, in this order:',
    ...apps.map((app) => `  pnpm --filter @devsprint/${app} exec wrangler rollback`),
    'A Worker this deploy created has no earlier version to go back to.',
    '',
  ]
}
