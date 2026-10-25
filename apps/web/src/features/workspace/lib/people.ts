/**
 * How a person is named wherever the board names them: by @handle, the way
 * the issue cards show an assignee. Nobody is "Unassigned", in words, never a
 * blank or a dash. An id the roster does not hold is shown as the id itself,
 * so a card never invents a person the board does not have.
 */
export function assigneeLabel(
  users: readonly { id: string; handle: string }[],
  assigneeId: string | null,
): string {
  if (assigneeId === null) return 'Unassigned'
  const user = users.find((candidate) => candidate.id === assigneeId)
  return user === undefined ? assigneeId : `@${user.handle}`
}

/** Whether an assignment names someone the board can hand an issue to; nobody always qualifies. */
export function isKnownAssignee(
  users: readonly { id: string }[],
  assigneeId: string | null,
): boolean {
  return assigneeId === null || users.some((user) => user.id === assigneeId)
}
