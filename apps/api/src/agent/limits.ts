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
import { ipRateLimitKey } from '@devsprint/shared'

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
 * How long after one reset the board refuses the next, from the
 * `RESET_COOLDOWN_SECONDS` var. Unset or `0` means no cooldown, which is what
 * the unit suite and the e2e stack want: they reset before every test. The
 * deployed value is in wrangler.jsonc.
 */
export function resolveResetCooldownMs(configured: string | undefined): number {
  const parsed = Number.parseInt(configured ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 0
}

/** What a refused reset tells the client to wait, whatever is left of the cooldown. */
export const RESET_RETRY_AFTER_SECONDS = 30

/**
 * The client this request should be rate-limited as.
 *
 * Cloudflare sets `CF-Connecting-IP` on every request that reaches a Worker,
 * including under `wrangler dev` (measured: `::1` locally). If it is somehow
 * absent we skip rather than fall back to a shared key — a shared bucket would
 * let one abusive client lock out everyone else, which is worse than not
 * limiting at all.
 *
 * An IPv6 client is keyed on its /64, not the address (`ipRateLimitKey`).
 */
export function rateLimitKey(request: Request): string | undefined {
  const ip = request.headers.get('cf-connecting-ip')?.trim()
  return ip ? ipRateLimitKey(ip) : undefined
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
 * Added when the refused request was an approval resume. The card above still
 * reads "Approved by you", and nothing on it can say otherwise, because the
 * write never ran and has no result. This line is the only thing telling the
 * reader so.
 */
export const APPROVAL_NOT_APPLIED_MESSAGE =
  'Anything you just approved has not been applied. Ask for it again if you still want it.'

/**
 * Whether this request resumes a turn from its approval cards. The SPA only ever
 * sends a transcript ending on the assistant for that, and a question ends on
 * the person's message. Reads the unvalidated body because the rate limit runs
 * before validation.
 */
export function isApprovalResume(messages: unknown[]): boolean {
  const last: unknown = messages.at(-1)
  return typeof last === 'object' && last !== null && 'role' in last && last.role === 'assistant'
}

/**
 * The limit message for this request, saying what became of the approval when
 * the request carried one.
 */
export function limitMessage(message: string, messages: unknown[]): string {
  return isApprovalResume(messages) ? `${message} ${APPROVAL_NOT_APPLIED_MESSAGE}` : message
}

/**
 * A complete assistant turn carrying one message, streamed the same way a real
 * answer is. Returning a 200 with a readable turn is what makes the degraded
 * state designed rather than broken.
 *
 * The text gets a step of its own. The SPA resends once the tools in the last
 * step have all been answered, and it only looks after the last step boundary.
 * Written into the step that holds the answered cards, this message would leave
 * that condition true, so one approval press would resend for as long as the
 * limit lasted, and the write would run with no new press once the limit lifted.
 */
export function messageOnlyResponse(text: string, headers: Record<string, string>): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = crypto.randomUUID()
      writer.write({ type: 'start-step' })
      writer.write({ type: 'text-start', id })
      writer.write({ type: 'text-delta', id, delta: text })
      writer.write({ type: 'text-end', id })
      writer.write({ type: 'finish-step' })
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
