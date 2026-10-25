/** No more lines than this across the plot, the zero line included. */
export const MAX_VALUE_TICKS = 5

/**
 * The y-axis values a chart labels: zero and every multiple of one round step
 * (1, 2 or 5 times a power of ten, never under a whole point) up to the top of
 * the scale. Thirds of the maximum read 0 / 10 / 21 / 31, steps a reader cannot
 * count in; a round step reads 0 / 10 / 20 / 30, and the scale itself keeps
 * the maximum, so the line's top is not pushed down to make room for a 40.
 */
export function valueTicks(max: number): number[] {
  if (!(max > 0)) return [0]
  let magnitude = 1
  for (;;) {
    for (const multiple of [1, 2, 5]) {
      const step = multiple * magnitude
      if (Math.floor(max / step) + 1 <= MAX_VALUE_TICKS) {
        return Array.from({ length: Math.floor(max / step) + 1 }, (_, index) => index * step)
      }
    }
    magnitude *= 10
  }
}
