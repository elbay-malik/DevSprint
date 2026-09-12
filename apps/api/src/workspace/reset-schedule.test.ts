import { describe, expect, it } from 'vitest'
import { nextUtcMidnightAfter } from './reset-schedule'

describe('nextUtcMidnightAfter', () => {
  it('finds tomorrow midnight from partway through today', () => {
    expect(nextUtcMidnightAfter(Date.parse('2026-07-01T09:00:00Z'))).toBe(
      Date.parse('2026-07-02T00:00:00Z'),
    )
  })

  it('finds tomorrow midnight from a moment just before it', () => {
    expect(nextUtcMidnightAfter(Date.parse('2026-07-01T23:59:59.999Z'))).toBe(
      Date.parse('2026-07-02T00:00:00Z'),
    )
  })

  it('is strictly after: landing exactly on a boundary still returns the next one', () => {
    // Otherwise an alarm firing at exactly midnight would reschedule itself for
    // the same instant it just fired at.
    expect(nextUtcMidnightAfter(Date.parse('2026-07-02T00:00:00Z'))).toBe(
      Date.parse('2026-07-03T00:00:00Z'),
    )
  })

  it('is always exactly one day out', () => {
    const from = Date.parse('2026-12-31T11:17:42Z')
    expect(nextUtcMidnightAfter(from) - from).toBeLessThanOrEqual(86_400_000)
    expect(nextUtcMidnightAfter(from) - from).toBeGreaterThan(0)
  })
})
