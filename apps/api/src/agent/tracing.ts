/**
 * OTLP tracing for a turn, without the OpenTelemetry SDK (ADR-0015).
 *
 * The AI SDK takes a `tracer` directly on the agent, so the only OTel surface
 * actually needed is the `Tracer`/`Span` shape it calls. What it does *not*
 * hand us is span parentage: it creates a span inside `startActiveSpan`'s
 * callback, and for `ai.streamText` that callback returns the stream long
 * before the tool call and the second model call happen. Tracking the current
 * parent with a stack therefore produces a completely flat trace — every span
 * a root — which still exports cleanly and still returns 200, and is simply
 * wrong. `AsyncLocalStorage` is what makes the tree correct, and it works on
 * workerd (measured; see ADR-0015).
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** Cloudflare's own header; Langfuse ignores it, a generic collector may not. */
const OTLP_PATH = '/v1/traces'

export interface TracingConfig {
  /** e.g. `https://cloud.langfuse.com/api/public/otel` */
  endpoint: string
  /** Langfuse public key. */
  publicKey: string
  /** Langfuse secret key. */
  secretKey: string
  /** Distinguishes environments in the Langfuse UI. */
  serviceName?: string
}

/**
 * Reads tracing config from the environment, or returns undefined.
 *
 * Undefined is the normal case: with no keys the tracer is never installed, so
 * local dev and CI run with no network and no account — the same posture the
 * model routing takes with its scripted mock.
 */
export function resolveTracingConfig(env: {
  LANGFUSE_HOST?: string
  LANGFUSE_PUBLIC_KEY?: string
  LANGFUSE_SECRET_KEY?: string
  DEVSPRINT_ENV?: string
}): TracingConfig | undefined {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim()
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim()
  if (!publicKey || !secretKey) return undefined

  const host = env.LANGFUSE_HOST?.trim() || 'https://cloud.langfuse.com'
  return {
    endpoint: `${host.replace(/\/$/, '')}/api/public/otel`,
    publicKey,
    secretKey,
    ...(env.DEVSPRINT_ENV ? { serviceName: `devsprint-api-${env.DEVSPRINT_ENV}` } : {}),
  }
}

type AttributeValue = string | number | boolean | Array<string | number | boolean> | undefined

interface FinishedSpan {
  name: string
  traceId: string
  spanId: string
  parentSpanId: string | undefined
  startTimeNanos: bigint
  endTimeNanos: bigint
  attributes: Record<string, AttributeValue>
  events: Array<{ name: string; timeNanos: bigint }>
  error: { message: string } | undefined
}

/** OTLP wants hex: 16 bytes for a trace id, 8 for a span id. */
function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  let out = ''
  for (const value of values) out += value.toString(16).padStart(2, '0')
  return out
}

function nowNanos(): bigint {
  // `Date.now()` is milliseconds, and this is the one place real wall-clock
  // time is correct: a trace timestamp is infrastructure, not workspace data,
  // so the frozen demo clock would make every span land in July.
  return BigInt(Date.now()) * 1_000_000n
}

/** OTLP's `AnyValue`. Anything unexpected is stringified rather than dropped. */
function toAnyValue(value: NonNullable<AttributeValue>): Record<string, unknown> {
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: `${value}` } : { doubleValue: value }
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((entry) => toAnyValue(entry)) } }
  }
  return { stringValue: value }
}

function toOtlpSpan(span: FinishedSpan): Record<string, unknown> {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    // SPAN_KIND_INTERNAL: every span here is work inside this Worker.
    kind: 1,
    startTimeUnixNano: `${span.startTimeNanos}`,
    endTimeUnixNano: `${span.endTimeNanos}`,
    attributes: Object.entries(span.attributes).flatMap(([key, value]) =>
      value === undefined ? [] : [{ key, value: toAnyValue(value) }],
    ),
    events: span.events.map((event) => ({
      name: event.name,
      timeUnixNano: `${event.timeNanos}`,
    })),
    ...(span.error
      ? { status: { code: 2, message: span.error.message } }
      : { status: { code: 1 } }),
  }
}

export interface TurnTracer {
  /** Passed to the agent as `experimental_telemetry.tracer`. */
  tracer: unknown
  /** The trace id, so a log line can be joined to the trace it belongs to. */
  traceId: string
  /**
   * Ships whatever has finished. Safe to call once the turn is over; errors are
   * swallowed, because a tracing backend is never a reason to fail an answer.
   */
  flush: () => Promise<void>
}

/**
 * A tracer for exactly one turn.
 *
 * Per-turn rather than per-isolate because a trace *is* a turn here, and
 * because it keeps finished spans in a plain array that goes away with the
 * request rather than accumulating in a long-lived isolate.
 */
export function createTurnTracer(config: TracingConfig): TurnTracer {
  const traceId = randomHex(16)
  const finished: FinishedSpan[] = []
  const parents = new AsyncLocalStorage<string>()

  const startSpan = (name: string, attributes: Record<string, AttributeValue>) => {
    const spanId = randomHex(8)
    const record: FinishedSpan = {
      name,
      traceId,
      spanId,
      parentSpanId: parents.getStore(),
      startTimeNanos: nowNanos(),
      endTimeNanos: 0n,
      attributes: { ...attributes },
      events: [],
      error: undefined,
    }

    let ended = false
    const span = {
      spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
      setAttribute(key: string, value: AttributeValue) {
        record.attributes[key] = value
        return span
      },
      setAttributes(values: Record<string, AttributeValue>) {
        Object.assign(record.attributes, values)
        return span
      },
      addEvent(eventName: string) {
        record.events.push({ name: eventName, timeNanos: nowNanos() })
        return span
      },
      addLink: () => span,
      addLinks: () => span,
      setStatus(status: { code: number; message?: string }) {
        // 2 is ERROR in the OTel status enum.
        if (status.code === 2) record.error = { message: status.message ?? 'error' }
        return span
      },
      updateName(updated: string) {
        record.name = updated
        return span
      },
      end() {
        // The SDK ends some spans on both the success and the error path, and
        // a span recorded twice would show up twice in the trace.
        if (ended) return span
        ended = true
        record.endTimeNanos = nowNanos()
        finished.push(record)
        return span
      },
      isRecording: () => !ended,
      recordException(error: { message?: string }) {
        record.error = { message: error.message ?? 'exception' }
        record.events.push({ name: 'exception', timeNanos: nowNanos() })
        return span
      },
    }
    return { span, spanId }
  }

  const tracer = {
    startSpan(name: string, options?: { attributes?: Record<string, AttributeValue> }) {
      return startSpan(name, options?.attributes ?? {}).span
    },
    startActiveSpan(name: string, ...args: unknown[]) {
      const options = (typeof args[0] === 'object' && args[0] !== null ? args[0] : {}) as {
        attributes?: Record<string, AttributeValue>
      }
      const fn = args.find((arg) => typeof arg === 'function') as (span: unknown) => unknown
      const { span, spanId } = startSpan(name, options.attributes ?? {})
      // The parent travels in the async context, not a stack — see the note at
      // the top of this file for what a stack gets wrong here.
      return parents.run(spanId, () => fn(span))
    },
  }

  const flush = async (): Promise<void> => {
    if (finished.length === 0) return
    const batch = finished.splice(0, finished.length)
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: 'service.name',
                value: { stringValue: config.serviceName ?? 'devsprint-api' },
              },
            ],
          },
          scopeSpans: [{ scope: { name: 'devsprint' }, spans: batch.map(toOtlpSpan) }],
        },
      ],
    }

    try {
      const response = await fetch(`${config.endpoint}${OTLP_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${btoa(`${config.publicKey}:${config.secretKey}`)}`,
          // Langfuse v4 real-time ingestion.
          'x-langfuse-ingestion-version': '4',
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        console.warn(
          JSON.stringify({ event: 'otlp-export-rejected', status: response.status, traceId }),
        )
      }
    } catch (error) {
      // Deliberately swallowed. The answer already went to the user; losing a
      // trace is not a reason to turn a served request into a failed one.
      console.warn(JSON.stringify({ event: 'otlp-export-failed', traceId, error: String(error) }))
    }
  }

  return { tracer, traceId, flush }
}
