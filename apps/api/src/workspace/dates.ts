/**
 * UTC calendar-day helpers. Inputs are ISO-8601 strings — full timestamps or
 * date-only `YYYY-MM-DD`, which ECMAScript parses as UTC midnight. Nothing
 * here reads the real clock; callers pass `workspace.now`.
 */

const DAY_MS = 86_400_000

/** UTC calendar day (`YYYY-MM-DD`) of an ISO timestamp or date-only string. */
export function utcDateOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

/**
 * Whole calendar days from `fromDate` to `toDate` (both `YYYY-MM-DD`);
 * negative when `toDate` is earlier.
 */
export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS)
}

/** Every UTC calendar day from `startDate` to `endDate` inclusive, ascending. */
export function eachUtcDay(startDate: string, endDate: string): string[] {
  const days: string[] = []
  const end = Date.parse(endDate)
  for (let time = Date.parse(startDate); time <= end; time += DAY_MS) {
    days.push(new Date(time).toISOString().slice(0, 10))
  }
  return days
}
