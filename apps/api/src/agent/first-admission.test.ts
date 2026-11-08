import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIRST_ADMISSION_TIMEOUT_MS, holdUntilDecided } from './first-admission'

/** A promise that never settles: a first call that was never made. */
const never = () => new Promise<'budget' | undefined>(() => undefined)

/** A stream the test feeds by hand. */
function handFed<T>() {
  let controller!: ReadableStreamDefaultController<T>
  const stream = new ReadableStream<T>({
    start(start) {
      controller = start
    },
  })
  return { stream, controller }
}

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const seen: T[] = []
  const reader = stream.getReader()
  for (let next = await reader.read(); !next.done; next = await reader.read()) seen.push(next.value)
  return seen
}

afterEach(() => {
  vi.useRealTimers()
})

describe('holdUntilDecided', () => {
  const signal = () => new AbortController().signal

  it('stops waiting when the stream ends without any model call', async () => {
    const { stream, controller } = handFed<string>()
    controller.enqueue('start')
    controller.enqueue('error')
    controller.close()

    const held = await holdUntilDecided(stream, never(), { signal: signal() })

    expect(held.decision).toBeUndefined()
    expect(await readAll(held.release())).toEqual(['start', 'error'])
  })

  it('stops waiting when the stream fails without any model call, and passes the failure on', async () => {
    const { stream, controller } = handFed<string>()
    controller.enqueue('start')
    controller.error(new Error('tool failed'))

    const held = await holdUntilDecided(stream, never(), { signal: signal() })

    expect(held.decision).toBeUndefined()
    const reader = held.release().getReader()
    await expect(reader.read()).rejects.toThrow('tool failed')
  })

  it('gives up after the timeout and sends the stream as it is', async () => {
    vi.useFakeTimers()
    const { stream, controller } = handFed<string>()
    controller.enqueue('start')

    const waiting = holdUntilDecided(stream, never(), { signal: signal() })
    await vi.advanceTimersByTimeAsync(FIRST_ADMISSION_TIMEOUT_MS)
    const held = await waiting

    expect(held.decision).toBeUndefined()
    controller.enqueue('late')
    controller.close()
    expect(await readAll(held.release())).toEqual(['start', 'late'])
  })

  it('waits ten seconds by default, not less', async () => {
    vi.useFakeTimers()
    const { stream } = handFed<string>()
    let settled = false

    void holdUntilDecided(stream, never(), { signal: signal() }).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(FIRST_ADMISSION_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(settled).toBe(true)
    expect(FIRST_ADMISSION_TIMEOUT_MS).toBe(10_000)
  })

  it('stops waiting when the client leaves', async () => {
    const { stream } = handFed<string>()
    const leaving = new AbortController()

    const waiting = holdUntilDecided(stream, never(), { signal: leaving.signal })
    leaving.abort()

    expect((await waiting).decision).toBeUndefined()
  })

  it('returns a refusal, and the stream can be given up', async () => {
    const cancelled = vi.fn()
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('start')
      },
      cancel: cancelled,
    })

    const held = await holdUntilDecided(stream, Promise.resolve('budget' as const), {
      signal: signal(),
    })
    await held.cancel()

    expect(held.decision).toBe('budget')
    expect(cancelled).toHaveBeenCalled()
  })

  it('treats a failed admission as no decision, so the stream carries the error', async () => {
    const { stream, controller } = handFed<string>()
    controller.enqueue('start')

    const held = await holdUntilDecided(stream, Promise.reject(new Error('unavailable')), {
      signal: signal(),
    })

    expect(held.decision).toBeUndefined()
    controller.close()
    expect(await readAll(held.release())).toEqual(['start'])
  })

  it('hands back every chunk in order, those read while waiting first', async () => {
    const { stream, controller } = handFed<number>()
    let admit!: (limit: undefined) => void
    const decided = new Promise<undefined>((resolve) => {
      admit = resolve
    })

    const waiting = holdUntilDecided(stream, decided, { signal: signal() })
    controller.enqueue(1)
    controller.enqueue(2)
    await new Promise((resolve) => setTimeout(resolve, 0))
    admit(undefined)
    const held = await waiting
    controller.enqueue(3)
    controller.close()

    expect(await readAll(held.release())).toEqual([1, 2, 3])
  })
})
