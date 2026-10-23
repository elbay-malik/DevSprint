/**
 * The two spend controls Phase 11 owes (ADR-0016), and they are deliberately
 * different mechanisms because they are answering different questions.
 *
 * A per-IP rate limit answers "is one client hammering us?" — Cloudflare's own
 * binding does that well, and its documented looseness ("permissive, eventually
 * consistent, intentionally designed to not be used as an accurate accounting
 * system", and per-location rather than global) costs nothing there.
 *
 * A daily token cap answers "has the demo spent its budget?" — the same
 * looseness would be disqualifying, because a cap that undercounts is a cap
 * that does not hold. That one lives in the workspace Durable Object, which is
 * global and serialises.
 */
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'

/** Cloudflare's rate-limit binding, as much of it as this Worker uses. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/**
 * How much the demo may spend in a UTC day before it stops answering.
 *
 * Defaults to Groq's free-tier 100K tokens/day (ADR-0005), so the cap and the
 * quota it is protecting are the same number unless someone says otherwise.
 * `0` disables the cap, which is what local dev and CI want.
 */
export const DEFAULT_DAILY_TOKEN_CAP = 100_000

export function resolveDailyTokenCap(configured: string | undefined): number | undefined {
  if (configured === undefined) return DEFAULT_DAILY_TOKEN_CAP
  const parsed = Number.parseInt(configured, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

/**
 * The client this request should be rate-limited as.
 *
 * Cloudflare sets `CF-Connecting-IP` on every request that reaches a Worker,
 * including under `wrangler dev` (measured: `::1` locally). If it is somehow
 * absent we skip rather than fall back to a shared key — a shared bucket would
 * let one abusive client lock out everyone else, which is worse than not
 * limiting at all.
 */
export function rateLimitKey(request: Request): string | undefined {
  const ip = request.headers.get('cf-connecting-ip')?.trim()
  return ip && ip.length > 0 ? ip : undefined
}

/**
 * The message the demo shows instead of an answer once the day's budget is
 * gone. ADR-0005 asks for "a graceful 'demo budget reached' state instead of
 * surfacing provider errors", so this is a normal assistant turn, not an HTTP
 * error: the transcript stays readable and the SPA needs no special case.
 */
export const BUDGET_REACHED_MESSAGE =
  'The copilot has used its model budget for today and is back at midnight UTC. ' +
  'The board stays live in the meantime.'

export const RATE_LIMITED_MESSAGE =
  'Too many requests in a short time, so this one was skipped. Ask again in a few seconds.'

/**
 * A complete assistant turn carrying one message, streamed the same way a real
 * answer is. Returning a 200 with a readable turn is what makes the degraded
 * state designed rather than broken.
 */
export function messageOnlyResponse(text: string, headers: Record<string, string>): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = crypto.randomUUID()
      writer.write({ type: 'text-start', id })
      writer.write({ type: 'text-delta', id, delta: text })
      writer.write({ type: 'text-end', id })
    },
  })
  return createUIMessageStreamResponse({
    stream,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Content-Encoding': 'Identity',
      ...headers,
    },
  })
}
