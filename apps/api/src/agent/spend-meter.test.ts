import { describe, expect, it, vi } from 'vitest'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from './provider-types'
import { createSpendMeter } from './spend-meter'

const CALL = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(400) }] }],
} as unknown as LanguageModelV3CallOptions

function meter() {
  const charge = vi.fn<(tokens: number) => void>()
  const refund = vi.fn<(tokens: number) => void>()
  const total = () =>
    charge.mock.calls.reduce((sum, [tokens]) => sum + tokens, 0) -
    refund.mock.calls.reduce((sum, [tokens]) => sum + tokens, 0)
  return { charge, refund, total, spend: createSpendMeter({ charge, refund }) }
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
