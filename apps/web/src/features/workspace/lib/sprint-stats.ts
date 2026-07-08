import { ISSUE_STATUSES, type Issue, type IssueStatus } from '@devsprint/shared'

export interface SprintStats {
  totalIssues: number
  byStatus: Record<IssueStatus, number>
  committedPoints: number
  completedPoints: number
  remainingPoints: number
  completionPct: number
}

export function computeSprintStats(issues: Issue[]): SprintStats {
  const byStatus = Object.fromEntries(ISSUE_STATUSES.map((status) => [status, 0])) as Record<
    IssueStatus,
    number
  >
  let committedPoints = 0
  let completedPoints = 0
  for (const issue of issues) {
    byStatus[issue.status] += 1
    committedPoints += issue.points
    if (issue.status === 'done') completedPoints += issue.points
  }
  const remainingPoints = committedPoints - completedPoints
  const completionPct =
    committedPoints === 0 ? 0 : Math.round((completedPoints / committedPoints) * 100)
  return {
    totalIssues: issues.length,
    byStatus,
    committedPoints,
    completedPoints,
    remainingPoints,
    completionPct,
  }
}
