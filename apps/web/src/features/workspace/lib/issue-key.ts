/**
 * The board's issue for a key the model wrote, matched the way the api's
 * `update_issue_status` finds it (apps/api/src/workspace/mutations.ts): case
 * folded on both sides, and the requested key trimmed. Matching more strictly
 * here would warn "isn't on the board" about a change that would succeed, and
 * leave its card unmarked and its points uncounted.
 */
export function findIssueByKey<T extends { key: string }>(
  issues: readonly T[],
  key: string,
): T | undefined {
  const wanted = key.trim().toLowerCase()
  return issues.find((candidate) => candidate.key.toLowerCase() === wanted)
}
