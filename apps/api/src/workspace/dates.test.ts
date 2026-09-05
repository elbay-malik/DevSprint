import { describe, expect, it } from 'vitest'
import { daysBetween, eachUtcDay, utcDateOf } from './dates'

describe('utc date helpers', () => {
  it('takes the UTC calendar day of a timestamp', () => {
    expect(utcDateOf('2026-07-01T09:00:00Z')).toBe('2026-07-01')
    expect(utcDateOf('2026-06-22')).toBe('2026-06-22')
  })

  it('counts whole calendar days in both directions', () => {
    expect(daysBetween('2026-07-01', '2026-07-05')).toBe(4)
    expect(daysBetween('2026-07-01', '2026-07-01')).toBe(0)
    expect(daysBetween('2026-07-01', '2026-06-19')).toBe(-12)
  })

  it('enumerates an inclusive day range', () => {
    expect(eachUtcDay('2026-06-22', '2026-07-05')).toHaveLength(14)
    expect(eachUtcDay('2026-06-22', '2026-06-22')).toEqual(['2026-06-22'])
    expect(eachUtcDay('2026-06-22', '2026-06-21')).toEqual([])
  })
})
