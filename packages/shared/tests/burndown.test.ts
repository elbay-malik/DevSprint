import { describe, expect, it } from 'vitest'
import {
  daysLeftIn,
  idealRemaining,
  idealRemainingOn,
  paceAgainstIdeal,
} from '../src/workspace/burndown'

const sprint12 = { startDate: '2026-06-22', endDate: '2026-07-05' }

describe('the ideal burndown line', () => {
  it('runs linearly from the committed points to 0, to the hundredth', () => {
    expect(idealRemaining(31, 0, 13)).toBe(31)
    expect(idealRemaining(31, 9, 13)).toBe(9.54)
    expect(idealRemaining(31, 13, 13)).toBe(0)
  })

  it('is burned down on the only day of a one-day sprint', () => {
    expect(idealRemaining(8, 0, 0)).toBe(0)
  })

  it('reads the day of the demo clock, held to the sprint', () => {
    // Sprint 12 on 2026-07-01 is day 9 of 0–13: the 9.54 the chart shows.
    expect(idealRemainingOn(31, sprint12, '2026-07-01T09:00:00Z')).toBe(9.54)
    expect(idealRemainingOn(31, sprint12, '2026-06-01T00:00:00Z')).toBe(31)
    expect(idealRemainingOn(31, sprint12, '2026-08-01T00:00:00Z')).toBe(0)
  })

  it('counts the days left to the sprint end, never below 0', () => {
    expect(daysLeftIn(sprint12, '2026-07-01T09:00:00Z')).toBe(4)
    expect(daysLeftIn(sprint12, '2026-07-05T23:00:00Z')).toBe(0)
    expect(daysLeftIn(sprint12, '2026-07-09T00:00:00Z')).toBe(0)
  })
})

describe('paceAgainstIdeal', () => {
  it('is behind above the line and ahead below it, in whole points', () => {
    expect(paceAgainstIdeal(23, 9.54)).toEqual({ direction: 'behind', points: 13 })
    expect(paceAgainstIdeal(3, 9.54)).toEqual({ direction: 'ahead', points: 7 })
  })

  it('is on track when the gap rounds to nothing', () => {
    expect(paceAgainstIdeal(10, 9.54)).toEqual({ direction: 'on_track', points: 0 })
  })
})
