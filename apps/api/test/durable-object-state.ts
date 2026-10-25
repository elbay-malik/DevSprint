/**
 * A minimal stand-in for `DurableObjectState`, so `WorkspaceDO` itself can be
 * unit-tested rather than only through `createLocalWorkspaceApi`'s parallel
 * in-memory implementation (ADR-0011 called this gap out: "the object's own
 * storage behaviour is covered by the live smoke rather than by unit tests").
 * It backs exactly the storage surface the class uses — get/put/delete and the
 * alarm pair — cast at the boundary the same way `fakeWorkspaceBinding` casts
 * its stub, because the real interface carries platform internals no test
 * needs to satisfy.
 */
export function fakeDurableObjectState() {
  const data = new Map<string, unknown>()
  let alarmAt: number | null = null
  // The constructor's `blockConcurrencyWhile` call fires an async callback it
  // does not await — real Durable Objects only guarantee no *request* is
  // handled before it settles, not that construction blocks on it. Tests need
  // that guarantee explicitly, which is what `ready()` gives them.
  let ready: Promise<unknown> = Promise.resolve()
  // Fires once, for the next `put` to the named key (or any key). This is what
  // lets a test prove a failure-handling *order* actually matters, rather than
  // only ever exercising the path where nothing goes wrong.
  let failNextPutFor: string | null = null
  let failNextPutForAnyKey = false

  const storage = {
    get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
    // Both forms the real storage takes: one key, or several written
    // atomically — which is why a failure for any key in a batch writes none.
    put: (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
      const entries = typeof keyOrEntries === 'string' ? { [keyOrEntries]: value } : keyOrEntries
      const keys = Object.keys(entries)
      if (failNextPutForAnyKey || (failNextPutFor !== null && keys.includes(failNextPutFor))) {
        failNextPutFor = null
        failNextPutForAnyKey = false
        return Promise.reject(new Error(`fake storage.put failed for '${keys.join(', ')}'`))
      }
      for (const key of keys) data.set(key, entries[key])
      return Promise.resolve()
    },
    delete: (key: string) => Promise.resolve(data.delete(key)),
    getAlarm: () => Promise.resolve(alarmAt),
    setAlarm: (time: number | Date) => {
      alarmAt = typeof time === 'number' ? time : time.getTime()
      return Promise.resolve()
    },
  }

  const ctx = {
    storage,
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => {
      ready = fn()
      return ready
    },
  }

  return {
    ctx: ctx as unknown as DurableObjectState,
    ready: () => ready,
    alarmAt: () => alarmAt,
    raw: data,
    /** The next `storage.put` for this key (or any key, if omitted) rejects instead of writing. */
    failNextPut: (key?: string) => {
      if (key === undefined) {
        failNextPutForAnyKey = true
      } else {
        failNextPutFor = key
      }
    },
  }
}
