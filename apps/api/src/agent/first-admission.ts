/**
 * The route's wait on a turn's first model-call admission (ADR-0016's
 * 2026-11-08 status note), built so that it cannot hang.
 *
 * The admission is only asked for once the model is called, and nothing
 * guarantees the model is called: the SDK or a tool can fail first, and the
 * stream then ends without one. So the wait reads the turn's stream while it
 * waits. It stops at whichever comes first: the decision, the end of the
 * stream, the client leaving, or a timeout. Whatever it read meanwhile is held,
 * and `release` hands the stream back from its first chunk.
 */

/**
 * How long the route waits before it sends the stream anyway. A refusal that
 * comes later is still honoured, through the in-stream path: the refused call
 * ends its step and the turn closes with the limit's message.
 */
export const FIRST_ADMISSION_TIMEOUT_MS = 10_000

export interface HeldStream<T, D> {
  /** The decision, or undefined when the wait ended for any other reason. */
  decision: D | undefined
  /** The stream from its first chunk, including what was read while waiting. */
  release: () => ReadableStream<T>
  /** Gives the stream up, for a turn that is answered some other way. */
  cancel: () => Promise<void>
}

export async function holdUntilDecided<T, D>(
  stream: ReadableStream<T>,
  decided: Promise<D | undefined>,
  { signal, timeoutMs = FIRST_ADMISSION_TIMEOUT_MS }: { signal: AbortSignal; timeoutMs?: number },
): Promise<HeldStream<T, D>> {
  const reader = stream.getReader()
  const held: T[] = []
  let ended = false
  let failure: { error: unknown } | undefined
  let stop = false
  const pump = (async () => {
    try {
      while (!stop) {
        const next = await reader.read()
        if (next.done) {
          ended = true
          return
        }
        held.push(next.value)
      }
    } catch (error) {
      failure = { error }
    }
  })()

  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const decision = await Promise.race([
    decided.catch(() => undefined),
    pump.then(() => undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs)
    }),
    new Promise<undefined>((resolve) => {
      if (signal.aborted) return resolve(undefined)
      onAbort = () => resolve(undefined)
      signal.addEventListener('abort', onAbort, { once: true })
    }),
  ])
  clearTimeout(timer)
  if (onAbort) signal.removeEventListener('abort', onAbort)
  // A read still in flight lands in `held`, and the pump stops after it.
  stop = true

  return {
    decision,
    release: () =>
      new ReadableStream<T>({
        async pull(controller) {
          await pump
          if (held.length > 0) {
            controller.enqueue(held.shift() as T)
            return
          }
          if (failure) return controller.error(failure.error)
          if (ended) return controller.close()
          try {
            const next = await reader.read()
            if (next.done) controller.close()
            else controller.enqueue(next.value)
          } catch (error) {
            controller.error(error)
          }
        },
        cancel: (reason) => reader.cancel(reason),
      }),
    cancel: () => reader.cancel().catch(() => undefined),
  }
}
