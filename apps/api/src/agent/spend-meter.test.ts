import { describe, expect, it, vi } from 'vitest'
import type { SpendLimit } from '@devsprint/shared/tools'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from './provider-types'
import { createSpendMeter, MAX_CALL_ESTIMATE_TOKENS } from './spend-meter'

const CALL = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(400) }] }],
} as unknown as LanguageModelV3CallOptions

/**
 * A meter over a ledger that admits every call, the way the workspace does while
 * a limit has room: the admission's charge lands in `charge` with the rest.
 */
function meter(refuse: () => SpendLimit | undefined = () => undefined) {
  const charge = vi.fn<(tokens: number) => void>()
  const refund = vi.fn<(tokens: number) => void>()
  const admit = vi.fn((tokens: number) => {
    const limit = refuse()
    if (limit === undefined) charge(tokens)
    return Promise.resolve(limit)
  })
  const total = () =>
    charge.mock.calls.reduce((sum, [tokens]) => sum + tokens, 0) -
    refund.mock.calls.reduce((sum, [tokens]) => sum + tokens, 0)
  return { admit, charge, refund, total, spend: createSpendMeter({ admit, charge, refund }) }
}

function modelThat(doStream: LanguageModelV3['doStream']): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'test',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream,
  }
}

function streamOf(parts: Array<Record<string, unknown>>) {
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part as LanguageModelV3StreamPart)
        controller.close()
      },
    }),
  }
}

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader()
  while (!(await reader.read()).done);
}

describe('createSpendMeter', () => {
  it('charges the prompt before the provider is called', async () => {
    const { charge, spend } = meter()
    let chargedBeforeCall = 0
    const model = spend.wrap(
      modelThat(() => {
        chargedBeforeCall = charge.mock.calls.length
        return Promise.resolve(streamOf([]))
      }),
    )

    await model.doStream(CALL)

    expect(chargedBeforeCall).toBe(1)
    expect(charge.mock.calls[0]![0]).toBeGreaterThanOrEqual(100)
  })

  it('counts the tool definitions as part of what is sent', async () => {
    const bare = meter()
    const withTools = meter()
    const call = () => modelThat(() => Promise.resolve(streamOf([])))

    await bare.spend.wrap(call()).doStream(CALL)
    await withTools.spend
      .wrap(call())
      .doStream({ ...CALL, tools: [{ description: 'y'.repeat(4000) }] } as never)

    expect(withTools.total() - bare.total()).toBeGreaterThanOrEqual(1000)
  })

  it('charges a call no more than one call can cost as it starts', async () => {
    const { charge, refund, total, spend } = meter()
    const huge = {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(256 * 1024) }] }],
    } as unknown as LanguageModelV3CallOptions
    const left = new AbortController()
    left.abort()
    const model = spend.wrap(modelThat(() => Promise.reject(new Error('aborted'))))

    await expect(model.doStream({ ...huge, abortSignal: left.signal })).rejects.toThrow()

    expect(charge).toHaveBeenCalledWith(MAX_CALL_ESTIMATE_TOKENS)
    expect(refund).not.toHaveBeenCalled()
    expect(total()).toBe(MAX_CALL_ESTIMATE_TOKENS)
  })

  it('still charges output on top of a capped estimate', async () => {
    const { total, spend } = meter()
    const huge = {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(256 * 1024) }] }],
    } as unknown as LanguageModelV3CallOptions
    const model = spend.wrap(
      modelThat(() =>
        Promise.resolve(streamOf([{ type: 'text-delta', id: '1', delta: 'a'.repeat(4000) }])),
      ),
    )

    const { stream } = await model.doStream(huge)
    await drain(stream)

    expect(total()).toBe(MAX_CALL_ESTIMATE_TOKENS + 1000)
  })

  it('charges long output as it is written, so a step cut off late still counts', async () => {
    const { total, spend } = meter()
    const model = spend.wrap(
      modelThat(() =>
        Promise.resolve(
          streamOf([
            { type: 'text-delta', id: '1', delta: 'a'.repeat(3000) },
            { type: 'reasoning-delta', id: '2', delta: 'b'.repeat(3000) },
            { type: 'tool-input-delta', id: '3', delta: 'c'.repeat(3000) },
          ]),
        ),
      ),
    )

    const { stream } = await model.doStream(CALL)
    const prompt = total()
    await drain(stream)

    expect(total() - prompt).toBe(2250)
  })

  it('charges nothing extra for a short answer', async () => {
    const { charge, spend } = meter()
    const model = spend.wrap(
      modelThat(() =>
        Promise.resolve(streamOf([{ type: 'text-delta', id: '1', delta: 'a'.repeat(100) }])),
      ),
    )

    const { stream } = await model.doStream(CALL)
    await drain(stream)

    expect(charge).toHaveBeenCalledTimes(1)
  })

  it('passes every part through untouched', async () => {
    const { spend } = meter()
    const parts = [
      { type: 'stream-start', warnings: [] },
      { type: 'text-delta', id: '1', delta: 'a'.repeat(3000) },
      { type: 'finish', usage: {}, finishReason: 'stop' },
    ]
    const model = spend.wrap(modelThat(() => Promise.resolve(streamOf(parts))))

    const { stream } = await model.doStream(CALL)
    const seen: unknown[] = []
    const reader = stream.getReader()
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      seen.push(next.value)
    }

    expect(seen).toEqual(parts)
  })

  it('gives the charge back when the provider turns the call down', async () => {
    const { refund, total, spend } = meter()
    const refused = new Error('429')
    const model = spend.wrap(modelThat(() => Promise.reject(refused)))

    await expect(model.doStream(CALL)).rejects.toBe(refused)

    expect(refund).toHaveBeenCalledTimes(1)
    expect(total()).toBe(0)
  })

  it('keeps the charge when the client left during the call', async () => {
    const { refund, total, spend } = meter()
    const left = new AbortController()
    left.abort()
    const model = spend.wrap(modelThat(() => Promise.reject(new Error('aborted'))))

    await expect(model.doStream({ ...CALL, abortSignal: left.signal })).rejects.toThrow()

    expect(refund).not.toHaveBeenCalled()
    expect(total()).toBeGreaterThan(0)
  })

  it('leaves nothing behind from a refused call when the retry settles', async () => {
    const { total, spend } = meter()
    const model = spend.wrap(
      modelThat(
        vi
          .fn<LanguageModelV3['doStream']>()
          .mockRejectedValueOnce(new Error('500'))
          .mockResolvedValue(streamOf([])),
      ),
    )

    await expect(model.doStream(CALL)).rejects.toThrow()
    await model.doStream(CALL)
    spend.settle(7_000)

    expect(total()).toBe(7_000)
  })

  it('tops a low estimate up to the real figure', async () => {
    const { total, spend } = meter()

    await spend.wrap(modelThat(() => Promise.resolve(streamOf([])))).doStream(CALL)
    spend.settle(5_000)

    expect(total()).toBe(5_000)
  })

  it('brings a high estimate down to the real figure', async () => {
    const { refund, total, spend } = meter()

    await spend.wrap(modelThat(() => Promise.resolve(streamOf([])))).doStream(CALL)
    spend.settle(10)

    expect(refund).toHaveBeenCalledTimes(1)
    expect(total()).toBe(10)
  })

  it('keeps the estimate when the provider gives no figure', async () => {
    const { refund, total, spend } = meter()

    await spend.wrap(modelThat(() => Promise.resolve(streamOf([])))).doStream(CALL)
    const estimate = total()
    spend.settle(0)
    spend.settle(Number.NaN)

    expect(refund).not.toHaveBeenCalled()
    expect(total()).toBe(estimate)
  })

  it('settles each step on its own figure', async () => {
    const { total, spend } = meter()
    const model = spend.wrap(modelThat(() => Promise.resolve(streamOf([]))))

    await model.doStream(CALL)
    spend.settle(1_000)
    await model.doStream(CALL)
    spend.settle(2_000)

    expect(total()).toBe(3_000)
  })
})

describe('createSpendMeter — admission', () => {
  it('waits for the admission before it calls the provider', async () => {
    let admitNow: (limit: SpendLimit | undefined) => void = () => undefined
    const admit = vi.fn(
      () =>
        new Promise<SpendLimit | undefined>((resolve) => {
          admitNow = resolve
        }),
    )
    const provider = vi.fn(() => Promise.resolve(streamOf([])))
    const spend = createSpendMeter({ admit, charge: vi.fn(), refund: vi.fn() })

    const call = spend.wrap(modelThat(provider)).doStream(CALL)
    await Promise.resolve()
    expect(admit).toHaveBeenCalledTimes(1)
    expect(provider).not.toHaveBeenCalled()

    admitNow(undefined)
    await call
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('admits with the capped estimate, the same figure it would have charged', async () => {
    const { admit, spend } = meter()
    const huge = {
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(256 * 1024) }] }],
    } as unknown as LanguageModelV3CallOptions

    await spend.wrap(modelThat(() => Promise.resolve(streamOf([])))).doStream(huge)

    expect(admit).toHaveBeenCalledWith(MAX_CALL_ESTIMATE_TOKENS)
  })

  it('never calls the provider for a refused call, and ends its step cleanly', async () => {
    const { charge, refund, spend } = meter(() => 'client-budget')
    const provider = vi.fn(() => Promise.resolve(streamOf([])))

    const { stream } = await spend.wrap(modelThat(provider)).doStream(CALL)
    const parts: LanguageModelV3StreamPart[] = []
    const reader = stream.getReader()
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      parts.push(next.value)
    }
    spend.settle(0)

    expect(provider).not.toHaveBeenCalled()
    expect(parts.map((part) => part.type)).toEqual(['stream-start', 'finish'])
    expect(charge).not.toHaveBeenCalled()
    expect(refund).not.toHaveBeenCalled()
    expect(spend.refusedBy).toBe('client-budget')
    await expect(spend.firstAdmission).resolves.toBe('client-budget')
  })

  it("reports only the first call's admission as the first", async () => {
    let calls = 0
    const { spend } = meter(() => (calls++ === 0 ? undefined : 'budget'))
    const model = spend.wrap(modelThat(() => Promise.resolve(streamOf([]))))

    await model.doStream(CALL)
    spend.settle(1_000)
    await model.doStream(CALL)

    await expect(spend.firstAdmission).resolves.toBeUndefined()
    expect(spend.refusedBy).toBe('budget')
  })

  it('does not refund a call it never charged', async () => {
    // A refused retry after a 429: the refund belongs to the admitted attempt only.
    let calls = 0
    const { total, spend } = meter(() => (calls++ === 0 ? undefined : 'budget'))
    const model = spend.wrap(
      modelThat(vi.fn<LanguageModelV3['doStream']>().mockRejectedValueOnce(new Error('429'))),
    )

    await expect(model.doStream(CALL)).rejects.toThrow('429')
    await model.doStream(CALL)
    spend.settle(0)

    expect(total()).toBe(0)
  })

  it('fails the call, without the provider, when the admission itself fails', async () => {
    const provider = vi.fn(() => Promise.resolve(streamOf([])))
    const spend = createSpendMeter({
      admit: () => Promise.reject(new Error('workspace unavailable')),
      charge: vi.fn(),
      refund: vi.fn(),
    })

    await expect(spend.wrap(modelThat(provider)).doStream(CALL)).rejects.toThrow(
      'workspace unavailable',
    )

    expect(provider).not.toHaveBeenCalled()
    // The error reaches the stream, so the first admission does not hold the route up.
    await expect(spend.firstAdmission).resolves.toBeUndefined()
  })
})
