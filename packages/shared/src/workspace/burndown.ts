/**
 * The burndown's reference line and the board's pace against it, in one place
 * for every reader: the api's `get_burndown` draws the line, the scripted
 * model states the gap, and the SPA's stat row shows the same gap as a
 * sub-line under Remaining. Held apart, the chart could say one number and
 * the board another for the same day.
 */
import { daysBetween, utcDateOf } from './dates'
import type { Sprint } from './types'

const round2 = (value: number): number => Math.round(value * 100) / 100

/**
 * The ideal line on day `index` of a sprint whose last day is `lastIndex`:
 * linear from the committed points to 0, to the hundredth.
 */
export function idealRemaining(committedPoints: number, index: number, lastIndex: number): number {
  // A one-day sprint has no slope to interpolate; it is simply burned down by its only day.
  return lastIndex === 0 ? 0 : round2(committedPoints * (1 - index / lastIndex))
}

/**
 * The ideal line on the UTC day of `asOf`, held to the sprint's own days, the
 * way the chart reads "today": before the start it is the first day, after the
 * end the last.
 */
export function idealRemainingOn(
  committedPoints: number,
  sprint: Pick<Sprint, 'startDate' | 'endDate'>,
  asOf: string,
): number {
  const lastIndex = Math.max(0, daysBetween(sprint.startDate, sprint.endDate))
  const index = Math.min(lastIndex, Math.max(0, daysBetween(sprint.startDate, utcDateOf(asOf))))
  return idealRemaining(committedPoints, index, lastIndex)
}

/** Whole calendar days from the UTC day of `asOf` to the sprint's last day, never negative. */
export function daysLeftIn(sprint: Pick<Sprint, 'endDate'>, asOf: string): number {
  return Math.max(0, daysBetween(utcDateOf(asOf), sprint.endDate))
}

export interface Pace {
  /** Above the ideal line is behind; a gap that rounds to 0 is on track. */
  direction: 'behind' | 'ahead' | 'on_track'
  /** The gap in whole points. */
  points: number
}

/** Remaining work against the ideal line, as a whole-point gap. */
export function paceAgainstIdeal(remaining: number, ideal: number): Pace {
  const points = Math.round(Math.abs(remaining - ideal))
  if (points === 0) return { direction: 'on_track', points }
  return { direction: remaining > ideal ? 'behind' : 'ahead', points }
}
