import type { IssueStatus } from '@devsprint/shared'

/**
 * The one set of words for an issue's status, wherever a person reads it: the
 * board's columns, backlog cards, the issue table and the approval card. The
 * raw `in_review` stays in tool arguments and the API, never in the UI.
 */
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  in_review: 'In review',
  blocked: 'Blocked',
  done: 'Done',
}

/** The label for a status a tool or model supplied, which may not be a known one. */
export function statusLabel(status: unknown): string {
  return typeof status === 'string' && status in ISSUE_STATUS_LABELS
    ? ISSUE_STATUS_LABELS[status as IssueStatus]
    : String(status)
}
