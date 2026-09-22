import { describe, expect, it, vi } from 'vitest'
import { createTurnTracer, resolveTracingConfig } from './tracing'

const CONFIG = {
  endpoint: 'https://collector.test/api/public/otel',
  publicKey: 'pk-lf-test',
  secretKey: 'sk-lf-test',
}

/** The shape the AI SDK calls: `startActiveSpan(name, options, callback)`. */
interface MinimalTracer {
  startActiveSpan: (name: string, options: unknown, fn: (span: MinimalSpan) => unknown) => unknown
  startSpan: (name: string, options?: unknown) => MinimalSpan
}
interface MinimalSpan {
  setAttribute: (key: string, value: unknown) => MinimalSpan
  setStatus: (status: { code: number; message?: string }) => MinimalSpan
  addEvent: (name: string) => MinimalSpan
  end: () => MinimalSpan
  spanContext: () => { traceId: string; spanId: string }
}

function postedPayload(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0] as [string, { body: string }]
  return JSON.parse(init.body) as {
    resourceSpans: Array<{
      resource: { attributes: Array<{ key: string; value: { stringValue: string } }> }
      scopeSpans: Array<{
        spans: Array<{
          name: string
          traceId: string
          spanId: string
          parentSpanId?: string
          startTimeUnixNano: string
          endTimeUnixNano: string
          attributes: Array<{ key: string; value: Record<string, unknown> }>
          status: { code: number; message?: string }
        }>
      }>
    }>
  }
}

function spansOf(fetchMock: ReturnType<typeof vi.fn>) {
  return postedPayload(fetchMock).resourceSpans[0]!.scopeSpans[0]!.spans
}

describe('resolveTracingConfig', () => {
  it('stays off unless both keys are present', () => {
    expect(resolveTracingConfig({})).toBeUndefined()
    expect(resolveTracingConfig({ LANGFUSE_PUBLIC_KEY: 'pk' })).toBeUndefined()
    expect(resolveTracingConfig({ LANGFUSE_SECRET_KEY: 'sk' })).toBeUndefined()
    // Whitespace is not a key.
    expect(
      resolveTracingConfig({ LANGFUSE_PUBLIC_KEY: '  ', LANGFUSE_SECRET_KEY: 'sk' }),
    ).toBeUndefined()
  })

  it('defaults to Langfuse Cloud and builds the OTLP path', () => {
    const config = resolveTracingConfig({
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
    })
    expect(config?.endpoint).toBe('https://cloud.langfuse.com/api/public/otel')
  })

  it('honours a regional or self-hosted host, trailing slash or not', () => {
    const config = resolveTracingConfig({
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      LANGFUSE_HOST: 'https://us.cloud.langfuse.com/',
    })
    expect(config?.endpoint).toBe('https://us.cloud.langfuse.com/api/public/otel')
  })
})

describe('createTurnTracer', () => {
  it('parents a span created after its parent callback returned', async () => {
    // The whole reason this file does not use a stack. `ai.streamText` hands
    // back the stream before its children exist, so by the time the tool call
    // is created a stack has already popped and every span becomes a root —
    // a flat trace that still exports cleanly and is simply wrong.
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { tracer, flush } = createTurnTracer(CONFIG)

    let streaming: Promise<void> | undefined
    await (tracer as MinimalTracer).startActiveSpan('ai.streamText', {}, (parent) => {
      // Work started inside the callback but finishing well after it returns —
      // the stream going on producing spans once streamText has handed back.
      streaming = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        ;(tracer as MinimalTracer).startSpan('ai.toolCall').end()
      })()
      parent.end()
      return undefined
    })
    await streaming
    await flush()

    const spans = spansOf(fetchMock)
    const root = spans.find((span) => span.name === 'ai.streamText')!
    const tool = spans.find((span) => span.name === 'ai.toolCall')!
    expect(root.parentSpanId).toBeUndefined()
    // Not a root: the async context still carries the parent.
    expect(tool.parentSpanId).toBe(root.spanId)
    expect(tool.traceId).toBe(root.traceId)
  })

  it('nests spans created inside the callback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { tracer, flush } = createTurnTracer(CONFIG)
    const t = tracer as MinimalTracer

    await t.startActiveSpan('outer', {}, async (outer) => {
      await t.startActiveSpan('inner', {}, async (inner) => {
        await Promise.resolve()
        inner.end()
      })
      outer.end()
    })
    await flush()

    const spans = spansOf(fetchMock)
    const outer = spans.find((span) => span.name === 'outer')!
    const inner = spans.find((span) => span.name === 'inner')!
    expect(inner.parentSpanId).toBe(outer.spanId)
  })

  it('emits ids and timestamps in the shapes OTLP requires', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { tracer, flush, traceId } = createTurnTracer(CONFIG)

    const span = (tracer as MinimalTracer).startSpan('ai.toolCall')
    span.setAttribute('ai.toolCall.name', 'get_sprint_status')
    span.setAttribute('ai.usage.tokens', 42)
    span.end()
    await flush()

    const [emitted] = spansOf(fetchMock)
    // 16 bytes and 8 bytes, hex — not the base64 or raw strings a collector rejects.
    expect(emitted?.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(emitted?.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(emitted?.traceId).toBe(traceId)
    // Nanoseconds, as a string — a JS number cannot hold them.
    expect(emitted?.startTimeUnixNano).toMatch(/^\d{19}$/)
    // Typed attribute values, not everything stringified.
    const byKey = Object.fromEntries(emitted!.attributes.map((a) => [a.key, a.value]))
    expect(byKey['ai.toolCall.name']).toEqual({ stringValue: 'get_sprint_status' })
    expect(byKey['ai.usage.tokens']).toEqual({ intValue: '42' })
  })

  it('authenticates the way Langfuse documents', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { tracer, flush } = createTurnTracer(CONFIG)
    ;(tracer as MinimalTracer).startSpan('x').end()
    await flush()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://collector.test/api/public/otel/v1/traces')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Basic ${btoa('pk-lf-test:sk-lf-test')}`)
    expect(headers['content-type']).toBe('application/json')
  })

  it('records an error status rather than dropping the span', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { tracer, flush } = createTurnTracer(CONFIG)

    const span = (tracer as MinimalTracer).startSpan('ai.toolCall')
    span.setStatus({ code: 2, message: 'boom' })
    span.end()
    await flush()

    expect(spansOf(fetchMock)[0]?.status).toEqual({ code: 2, message: 'boom' })
  })

  it('never lets a failed export fail the turn', async () => {
    // The answer has already reached the user by the time this runs. Losing a
    // trace is not a reason to turn a served request into a failed one.
    const fetchMock = vi.fn().mockRejectedValue(new Error('collector down'))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tracer, flush } = createTurnTracer(CONFIG)
    ;(tracer as MinimalTracer).startSpan('x').end()

    await expect(flush()).resolves.toBeUndefined()
    // ...but it is reported, rather than swallowed silently.
    expect(console.warn).toHaveBeenCalled()
  })

  it('posts nothing when the turn produced no spans', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { flush } = createTurnTracer(CONFIG)

    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not send the same span twice when the SDK ends it twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { tracer, flush } = createTurnTracer(CONFIG)

    const span = (tracer as MinimalTracer).startSpan('ai.streamText')
    span.end()
    span.end()
    await flush()

    expect(spansOf(fetchMock)).toHaveLength(1)
  })
})
