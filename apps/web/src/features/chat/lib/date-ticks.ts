/**
 * Which days of a chart's x-axis get a date label: the first and the last,
 * and every `step` days between, where the step is the fewest whole days whose
 * spacing clears one label plus a gap. An in-between label too close to the
 * last one is dropped rather than drawn into it.
 *
 * Every label is centred on its day. Labels are "MM/DD" in the 11px tabular
 * chart face, five glyphs at about 6.2px, so 34px is a safe width, and half of
 * it fits in the chart's side padding at either end.
 */
export const DATE_LABEL_WIDTH = 34
/** The clear space kept between two labels. */
export const DATE_LABEL_GAP = 12

const SPACING = DATE_LABEL_WIDTH + DATE_LABEL_GAP

export function dateTickIndices(dayCount: number, plotWidth: number): number[] {
  if (dayCount <= 0) return []
  const last = dayCount - 1
  // Too narrow for two labels: the start date alone.
  if (last === 0 || plotWidth < SPACING) return [0]

  const dayWidth = plotWidth / last
  const step = Math.max(1, Math.ceil(SPACING / dayWidth))
  const indices = [0]
  for (let index = step; index < last; index += step) {
    if ((last - index) * dayWidth >= SPACING) indices.push(index)
  }
  indices.push(last)
  return indices
}
