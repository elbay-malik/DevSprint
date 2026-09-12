/**
 * When the demo board's daily reset alarm should next fire.
 *
 * This is deliberately the one place in this package that reasons about the
 * real clock. `dates.ts` is explicit that nothing there reads it — every other
 * date computation works off `workspace.now`, the frozen demo clock, so the
 * scripted scenarios stay replayable. The reset alarm is infrastructure, not
 * workspace data: it has to fire on the calendar day the Worker is actually
 * running on, not the one the seed happens to be dated. Cloudflare's Alarms API
 * (`ctx.storage.setAlarm`) only understands real wall-clock time regardless.
 */

const DAY_MS = 86_400_000

/**
 * The next UTC midnight strictly after `fromMs`. Never `fromMs` itself, even
 * when it lands exactly on a boundary — an alarm scheduled for "now" would
 * either fire immediately or never, depending on rounding, neither of which is
 * "tomorrow".
 */
export function nextUtcMidnightAfter(fromMs: number): number {
  const todayMidnight = Math.floor(fromMs / DAY_MS) * DAY_MS
  return todayMidnight + DAY_MS
}
