import { describe, expect, it } from 'vitest'
import { DATE_LABEL_GAP, DATE_LABEL_WIDTH, dateTickIndices } from './date-ticks'

/** The burndown's side padding: the plot is the chart's width less these. */
const PAD = 32 + 42

describe('dateTickIndices', () => {
  it('labels Sprint 12 every few days in the phone and desktop columns', () => {
    // 14 days, in a 344px and a 310px chart, as narrow chat columns draw it.
    expect(dateTickIndices(14, 344 - PAD)).toEqual([0, 3, 6, 9, 13])
    expect(dateTickIndices(14, 310 - PAD)).toEqual([0, 3, 6, 9, 13])
    // The widest column has room for every other day.
    expect(dateTickIndices(14, 440 - PAD)).toEqual([0, 2, 4, 6, 8, 10, 13])
  })

  it('never puts two labels closer than a label and a gap, at any width', () => {
    for (let width = 160; width <= 900; width += 1) {
      for (const days of [2, 5, 10, 14, 21, 30]) {
        const plot = width - PAD
        const indices = dateTickIndices(days, plot)
        const xs = indices.map((index) => (index / (days - 1)) * plot)
        for (let i = 1; i < xs.length; i += 1) {
          expect(xs[i]! - xs[i - 1]!, `${days} days at ${width}px`).toBeGreaterThanOrEqual(
            DATE_LABEL_WIDTH + DATE_LABEL_GAP - 1e-9,
          )
        }
        expect(indices[0]).toBe(0)
      }
    }
  })

  it('always keeps the first and last day when both fit', () => {
    expect(dateTickIndices(14, 270).at(-1)).toBe(13)
    expect(dateTickIndices(2, 270)).toEqual([0, 1])
  })

  it('degrades to the first day alone when there is no room or no span', () => {
    expect(dateTickIndices(1, 270)).toEqual([0])
    expect(dateTickIndices(14, 30)).toEqual([0])
    expect(dateTickIndices(0, 270)).toEqual([])
  })
})
