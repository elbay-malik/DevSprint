import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DAILY_TOKEN_CAP,
  rateLimitKey,
  resolveDailyTokenCap,
  messageOnlyResponse,
} from './limits'

describe('resolveDailyTokenCap', () => {
  it('defaults to the free-tier quota it is protecting', () => {
    // ADR-0005 names Groq's 100K tokens/day; the cap and the quota being
    // guarded should be the same number unless someone says otherwise.
    expect(resolveDailyTokenCap(undefined)).toBe(DEFAULT_DAILY_TOKEN_CAP)
  })

  it('takes an explicit budget', () => {
    expect(resolveDailyTokenCap('25000')).toBe(25_000)
  })

  it('treats zero and nonsense as "no cap", not as "cap of zero"', () => {
    // A cap of zero would refuse every turn, which is the opposite of what
    // someone setting `0` to disable it means.
    expect(resolveDailyTokenCap('0')).toBeUndefined()
    expect(resolveDailyTokenCap('-5')).toBeUndefined()
    expect(resolveDailyTokenCap('lots')).toBeUndefined()
  })
})

describe('rateLimitKey', () => {
  it('keys on the IP Cloudflare attaches', () => {
    const request = new Request('https://example.test', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    })
    expect(rateLimitKey(request)).toBe('203.0.113.7')
  })

  it('keys an IPv6 client on its /64, so rotating addresses does not escape the limit', () => {
    const keyOf = (ip: string) =>
      rateLimitKey(new Request('https://example.test', { headers: { 'cf-connecting-ip': ip } }))
    expect(keyOf('2001:db8:1:2::a')).toBe('2001:db8:1:2::/64')
    expect(keyOf('2001:db8:1:2::b')).toBe('2001:db8:1:2::/64')
  })

  it('skips rather than sharing one bucket when the IP is missing', () => {
    // A shared key would let a single abusive client lock out everyone else,
    // which is worse than not limiting. Cloudflare sets this header on every
    // request that reaches a Worker, including under wrangler dev.
    expect(rateLimitKey(new Request('https://example.test'))).toBeUndefined()
    expect(
      rateLimitKey(new Request('https://example.test', { headers: { 'cf-connecting-ip': '  ' } })),
    ).toBeUndefined()
  })
})

describe('messageOnlyResponse', () => {
  it('is a readable assistant turn, not an error', async () => {
    // ADR-0005 asks for "a graceful demo budget reached state instead of
    // surfacing provider errors" — so the degraded state has to arrive as a
    // turn the transcript can render, with no special case in the SPA.
    const response = messageOnlyResponse('budget gone', { 'X-DevSprint-Limit': 'budget' })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-devsprint-limit')).toBe('budget')
    const body = await response.text()
    expect(body).toContain('text-delta')
    expect(body).toContain('budget gone')
  })
})
