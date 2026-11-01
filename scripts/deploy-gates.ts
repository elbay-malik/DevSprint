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
