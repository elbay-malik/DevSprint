import { describe, expect, it } from 'vitest'
import { MAX_VALUE_TICKS, valueTicks } from './value-ticks'

describe('valueTicks', () => {
  it('steps the seeded sprint by tens, not by thirds of 31', () => {
    // Thirds read 0 / 10 / 21 / 31: uneven steps on an axis meant to be counted.
    expect(valueTicks(31)).toEqual([0, 10, 20, 30])
  })

  it('takes the smallest round step that fits, and never a fraction of a point', () => {
    expect(valueTicks(1)).toEqual([0, 1])
    expect(valueTicks(4)).toEqual([0, 1, 2, 3, 4])
    expect(valueTicks(13)).toEqual([0, 5, 10])
    expect(valueTicks(40)).toEqual([0, 10, 20, 30, 40])
    expect(valueTicks(100)).toEqual([0, 50, 100])
  })

  it('keeps every step equal and the count in bounds', () => {
    for (let max = 1; max <= 500; max += 1) {
      const ticks = valueTicks(max)
      expect(ticks.length, String(max)).toBeLessThanOrEqual(MAX_VALUE_TICKS)
      expect(ticks.at(-1), String(max)).toBeLessThanOrEqual(max)
      const step = ticks[1] ?? 0
      ticks.forEach((tick, index) => expect(tick).toBe(index * step))
    }
  })

  it('has only the zero line for an empty scale', () => {
    expect(valueTicks(0)).toEqual([0])
  })
})
