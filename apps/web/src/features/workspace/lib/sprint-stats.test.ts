import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { computeSprintStats } from './sprint-stats'

describe('computeSprintStats', () => {
  it('computes stats for the seeded active sprint', () => {
    const issues = createWorkspaceSeed().issues.filter((i) => i.sprintId === 'sprint-12')
    const stats = computeSprintStats(issues)
    expect(stats.totalIssues).toBe(7)
    expect(stats.byStatus).toEqual({
      todo: 0,
      in_progress: 2,
      in_review: 2,
      blocked: 1,
      done: 2,
    })
    expect(stats.committedPoints).toBe(31)
    expect(stats.completedPoints).toBe(8)
    expect(stats.remainingPoints).toBe(23)
    expect(stats.completionPct).toBe(26)
  })

  it('is zero-safe for an empty issue list', () => {
    const stats = computeSprintStats([])
    expect(stats.totalIssues).toBe(0)
    expect(stats.committedPoints).toBe(0)
    expect(stats.completionPct).toBe(0)
  })
})
