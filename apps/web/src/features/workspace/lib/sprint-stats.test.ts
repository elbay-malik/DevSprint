import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { computeSprintStats, paceLabel } from './sprint-stats'

const seed = createWorkspaceSeed()
const sprint12 = seed.sprints.find((sprint) => sprint.id === 'sprint-12')!
const sprint12Issues = seed.issues.filter((i) => i.sprintId === 'sprint-12')

describe('computeSprintStats', () => {
  it('computes stats for the seeded active sprint', () => {
    const stats = computeSprintStats(sprint12Issues)
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
  })

  it('places the board on the burndown at the workspace clock', () => {
    // The chart's ideal on 2026-07-01 is 9.54, so 23 left is 13 behind it —
    // the same gap the copilot states for S-D.
    const stats = computeSprintStats(sprint12Issues, sprint12, seed.now)
    expect(stats.pace).toEqual({ direction: 'behind', points: 13 })
    expect(stats.daysLeft).toBe(4)
  })

  it('follows the board when issues move', () => {
    // S-B's close-out: four of the five open issues approved, DS-11 denied.
    const closed = sprint12Issues.map((issue) =>
      issue.key === 'DS-11' ? issue : { ...issue, status: 'done' as const },
    )
    const stats = computeSprintStats(closed, sprint12, seed.now)
    expect(stats.remainingPoints).toBe(3)
    expect(stats.pace).toEqual({ direction: 'ahead', points: 7 })
  })

  it('knows no pace without a sprint and a clock', () => {
    const stats = computeSprintStats(sprint12Issues)
    expect(stats.pace).toBeNull()
    expect(stats.daysLeft).toBeNull()
  })

  it('is zero-safe for an empty issue list', () => {
    const stats = computeSprintStats([], sprint12, seed.now)
    expect(stats.totalIssues).toBe(0)
    expect(stats.committedPoints).toBe(0)
    expect(stats.pace).toEqual({ direction: 'on_track', points: 0 })
  })
})

describe('paceLabel', () => {
  it('says the gap in board words', () => {
    expect(paceLabel({ direction: 'behind', points: 13 })).toBe('13 pts behind ideal')
    expect(paceLabel({ direction: 'ahead', points: 1 })).toBe('1 pt ahead of ideal')
    expect(paceLabel({ direction: 'on_track', points: 0 })).toBe('On track')
  })
})
