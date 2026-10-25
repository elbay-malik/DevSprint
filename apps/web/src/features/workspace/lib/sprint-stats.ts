import {
  ISSUE_STATUSES,
  daysLeftIn,
  idealRemainingOn,
  paceAgainstIdeal,
  type Issue,
  type IssueStatus,
  type Pace,
  type Sprint,
} from '@devsprint/shared'

export interface SprintStats {
  totalIssues: number
  byStatus: Record<IssueStatus, number>
  committedPoints: number
  completedPoints: number
  remainingPoints: number
  /**
   * Remaining against the burndown's ideal line on the board's own clock,
   * from the same function the chart's line comes from. Null without a sprint.
   */
  pace: Pace | null
  /** Calendar days to the sprint's last day, as `get_sprint_status` counts them. */
  daysLeft: number | null
}

/**
 * The stat row's numbers. `sprint` and `now` (the workspace's frozen clock,
 * never Date.now()) place the board on the burndown; without them the pace
 * and the days left are unknown, not zero.
 */
export function computeSprintStats(
  issues: Issue[],
  sprint?: Pick<Sprint, 'startDate' | 'endDate'>,
  now?: string,
): SprintStats {
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
  const placed = sprint !== undefined && now !== undefined
  return {
    totalIssues: issues.length,
    byStatus,
    committedPoints,
    completedPoints,
    remainingPoints,
    pace: placed
      ? paceAgainstIdeal(remainingPoints, idealRemainingOn(committedPoints, sprint, now))
      : null,
    daysLeft: placed ? daysLeftIn(sprint, now) : null,
  }
}

const pts = (points: number): string => `${points} ${points === 1 ? 'pt' : 'pts'}`

/** The Remaining tile's sub-line: "13 pts behind ideal", "On track", "2 pts ahead of ideal". */
export function paceLabel(pace: Pace): string {
  if (pace.direction === 'on_track') return 'On track'
  return `${pts(pace.points)} ${pace.direction === 'behind' ? 'behind' : 'ahead of'} ideal`
}
