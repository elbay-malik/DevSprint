/**
 * The per-client half of the daily model budget (ADR-0016's 2026-11-02 status
 * note). The Durable Object and its in-memory twin both go through
 * `addClientTokens`, so the bound behaves the same in each.
 */

/** Tokens per client for one UTC day, keyed by `hashClientKey` in the object. */
export interface ClientUsage {
  day: string
  tokens: Record<string, number>
}

/**
 * A ceiling on the clients a day can hold. Every entry costs 32 hex characters
 * plus a count, about 44 bytes of JSON, so a full map is about 88 KB and well
 * under what one storage value takes. An entry only appears once a client has
 * spent tokens, so at the default cap a day never gets near this. It is here for
 * a raised cap, and so that the size never depends on what clients do.
 */
export const CLIENT_USAGE_MAX = 2000

/**
 * Adds a step's tokens to a client, evicting the lowest spender once the map is
 * full. Lowest rather than oldest, because eviction hands a client a new share:
 * the entries worth keeping are the ones near their limit, so a client can't
 * clear its own count by filling the map with others.
 */
export function addClientTokens(
  tokens: Readonly<Record<string, number>>,
  key: string,
  spent: number,
  max: number = CLIENT_USAGE_MAX,
): Record<string, number> {
  // A step that reported no usage is not a client worth a slot.
  if (spent <= 0) return { ...tokens }
  const entries = new Map(Object.entries(tokens))
  entries.set(key, (entries.get(key) ?? 0) + spent)
  if (entries.size > max) {
    const others = [...entries].filter(([other]) => other !== key)
    const lowest = others.reduce((low, entry) => (entry[1] < low[1] ? entry : low))
    entries.delete(lowest[0])
  }
  return Object.fromEntries(entries)
}

/**
 * What the object stores in place of a client key, so no IP address or /64 sits
 * in its storage. The day goes in the hash too, so one day's entries can't be
 * matched to the next's.
 *
 * This keeps addresses out of a storage dump or a log. It does not make them
 * impossible to recover: anyone holding the map could hash every IPv4 address
 * for that day and compare.
 */
export async function hashClientKey(clientKey: string, day: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${day}:${clientKey}`),
  )
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
