/**
 * How long ago the board was last read, beside the Live board badge: "Updated
 * just now", "Updated 2 min ago", "Updated 1 hour ago". Whole minutes, because
 * the line is refreshed every 30s and seconds would only ever be stale.
 */
export function lastReadLabel(readAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - readAt) / 60_000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `Updated ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
}
