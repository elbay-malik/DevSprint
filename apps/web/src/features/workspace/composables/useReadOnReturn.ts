import { useEventListener } from '@vueuse/core'

/** A return to the tab re-reads the board at most this often. */
export const RETURN_READ_MIN_MS = 5000

export interface ReadOnReturnOptions {
  /** Re-reads the board: the store's hydrate, so a move is marked as it lands. */
  read: () => unknown
  /** True while a read would race something, such as a chat turn still streaming. */
  blocked: () => boolean
  /** When the board was last read, so a return just after a turn's own read is not a second. */
  lastReadAt: () => number | undefined
  minIntervalMs?: number
}

/**
 * Re-reads the board when the reader comes back to the tab: on window focus,
 * and on the page turning visible again. Writes made elsewhere (another
 * visitor, an MCP host, a Reset in another tab) land in the Worker, not here,
 * so without this they stayed invisible until the next chat turn.
 *
 * Still not polling: nothing runs while the reader is away, and a return reads
 * at most once every RETURN_READ_MIN_MS. A tab switch fires both events, and
 * the throttle is what makes that one read. While a turn streams it does not
 * read at all, since the turn's own read follows when it settles.
 */
export function useReadOnReturn(options: ReadOnReturnOptions): void {
  const minInterval = options.minIntervalMs ?? RETURN_READ_MIN_MS
  let lastAttempt = Number.NEGATIVE_INFINITY

  function onReturn(): void {
    if (document.visibilityState !== 'visible' || options.blocked()) return
    const now = Date.now()
    const last = Math.max(lastAttempt, options.lastReadAt() ?? Number.NEGATIVE_INFINITY)
    if (now - last < minInterval) return
    lastAttempt = now
    void options.read()
  }

  useEventListener(window, 'focus', onReturn)
  useEventListener(document, 'visibilitychange', onReturn)
}
