import type { RequestResetResult } from '@devsprint/shared/tools'

/** A cooldown refusal, as the workspace's `requestReset` gives it. */
export function resetCooldownRefusal(
  retryAfterSeconds: number,
): RequestResetResult & { ok: false } {
  return {
    ok: false,
    error: {
      code: 'RESET_COOLDOWN',
      message: `The board was reset moments ago. Try again in ${retryAfterSeconds} seconds.`,
    },
    retryAfterSeconds,
  }
}

/**
 * An isolate's memory of the reset cooldown, so a reset that is bound to be
 * refused is answered without a Durable Object call (ADR-0024's 2026-11-08
 * status note).
 *
 * The Durable Object stays the source of truth. What this keeps is a lower
 * bound on the moment the next reset is allowed, learned from the object's own
 * answers: an accepted reset happened no earlier than the request was sent, and
 * a refusal of `n` seconds (rounded up) leaves more than `n - 1`. The object's
 * last-reset time only moves forward, so a bound that held when it was learned
 * still holds. The gate therefore only refuses what the object would refuse
 * too. Once the bound has passed, or for a reset someone else made through
 * another isolate, the request goes through to the object as before.
 *
 * Its own Retry-After is what is left of that bound, which can be a little
 * shorter than the object's figure, never longer.
 */
export interface ResetGate {
  /** A refusal to answer with now, or undefined to ask the Durable Object. */
  check(now: number, cooldownMs: number): (RequestResetResult & { ok: false }) | undefined
  /** Learns from the object's answer to a request sent at `sentAt`. */
  learn(sentAt: number, cooldownMs: number, result: RequestResetResult): void
}

export function createResetGate(): ResetGate {
  let notBefore = Number.NEGATIVE_INFINITY
  return {
    check(now, cooldownMs) {
      // No cooldown (the e2e stack, the unit suite): nothing is ever refused.
      if (cooldownMs <= 0 || now >= notBefore) return undefined
      return resetCooldownRefusal(Math.max(1, Math.ceil((notBefore - now) / 1000)))
    },
    learn(sentAt, cooldownMs, result) {
      if (cooldownMs <= 0) return
      const bound = result.ok ? sentAt + cooldownMs : sentAt + (result.retryAfterSeconds - 1) * 1000
      notBefore = Math.max(notBefore, bound)
    },
  }
}
