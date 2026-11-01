import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_NOT_APPLIED_MESSAGE,
  BUDGET_REACHED_MESSAGE,
  CLIENT_BUDGET_REACHED_MESSAGE,
  DEFAULT_CLIENT_TOKEN_SHARE,
  DEFAULT_DAILY_TOKEN_CAP,
  limitMessage,
  rateLimitKey,
  resolveClientTokenShare,
  resolveDailyTokenCap,
  messageOnlyResponse,
  spendLimitReached,
} from './limits'

/** What the SPA holds after a response is folded into the message it continues. */
async function continued(response: Response, message: UIMessage): Promise<UIMessage> {
  const chunks = (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)) as UIMessageChunk)
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  let latest = message
  for await (const next of readUIMessageStream({ message, stream })) latest = next
  return latest
}

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

describe('resolveClientTokenShare', () => {
  it('defaults to a quarter of the default cap', () => {
    expect(resolveClientTokenShare(undefined)).toBe(DEFAULT_CLIENT_TOKEN_SHARE)
    expect(DEFAULT_CLIENT_TOKEN_SHARE).toBe(25_000)
    expect(DEFAULT_DAILY_TOKEN_CAP).toBe(DEFAULT_CLIENT_TOKEN_SHARE * 4)
  })

  it('takes an explicit share', () => {
    expect(resolveClientTokenShare('5000')).toBe(5_000)
  })

  it('treats zero and nonsense as "no share", the way the cap does', () => {
    expect(resolveClientTokenShare('0')).toBeUndefined()
    expect(resolveClientTokenShare('-5')).toBeUndefined()
    expect(resolveClientTokenShare('lots')).toBeUndefined()
  })
})

describe('spendLimitReached', () => {
  const day = '2026-11-02'

  it('is nothing while both have room, up to one token short', () => {
    expect(spendLimitReached({ day, tokens: 99, clientTokens: 49 }, 100, 50)).toBeUndefined()
  })

  it('names the share once the client reaches it', () => {
    expect(spendLimitReached({ day, tokens: 60, clientTokens: 50 }, 100, 50)).toBe('client-budget')
  })

  it('names the cap once the day reaches it, even for a client over its share', () => {
    expect(spendLimitReached({ day, tokens: 100, clientTokens: 90 }, 100, 50)).toBe('budget')
  })

  it('holds each limit when the other is off', () => {
    expect(spendLimitReached({ day, tokens: 900, clientTokens: 50 }, undefined, 50)).toBe(
      'client-budget',
    )
    expect(spendLimitReached({ day, tokens: 100, clientTokens: 90 }, 100, undefined)).toBe('budget')
    expect(spendLimitReached({ day, tokens: 900, clientTokens: 90 }, 1000, undefined)).toBe(
      undefined,
    )
  })

  it('has no share to apply when the read named no client', () => {
    expect(spendLimitReached({ day, tokens: 60 }, 100, 50)).toBeUndefined()
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

  it('does not make the SPA resend an answered approval', async () => {
    // `sendAutomaticallyWhen` only looks after the last step boundary. Written
    // into the step holding the answered card, this reply would leave that true,
    // and the SPA would resend for as long as the limit lasted, then run the
    // write with no new press once the limit lifted. Run on the SDK's own
    // reducer and predicate, since that is what the browser does.
    const answered = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-update_issue_status',
          toolCallId: 'c1',
          state: 'approval-responded',
          input: { issueKey: 'DS-7', status: 'done' },
          approval: { id: 'ap1', approved: true, signature: 'sig' },
        },
      ],
    } as unknown as UIMessage
    expect(lastAssistantMessageIsCompleteWithApprovalResponses({ messages: [answered] })).toBe(true)

    const after = await continued(messageOnlyResponse('budget gone', {}), answered)

    expect(after.parts.at(-1)).toMatchObject({ type: 'text', text: 'budget gone' })
    expect(lastAssistantMessageIsCompleteWithApprovalResponses({ messages: [after] })).toBe(false)
  })
})

describe('CLIENT_BUDGET_REACHED_MESSAGE', () => {
  it('reads differently from the message for the whole demo', () => {
    // One says come back at midnight because the demo is out, the other because
    // this connection is. A reader or a debugger has to be able to tell which.
    expect(CLIENT_BUDGET_REACHED_MESSAGE).not.toBe(BUDGET_REACHED_MESSAGE)
    expect(CLIENT_BUDGET_REACHED_MESSAGE).toContain('This connection')
    expect(CLIENT_BUDGET_REACHED_MESSAGE).not.toContain('The copilot has used')
  })
})

describe('limitMessage', () => {
  it('says a refused approval was not applied, since the card still reads approved', () => {
    const resume = [
      { role: 'user', parts: [] },
      { role: 'assistant', parts: [] },
    ]
    expect(limitMessage(BUDGET_REACHED_MESSAGE, resume)).toBe(
      `${BUDGET_REACHED_MESSAGE} ${APPROVAL_NOT_APPLIED_MESSAGE}`,
    )
  })

  it('does not talk about approvals on a plain question', () => {
    expect(limitMessage(BUDGET_REACHED_MESSAGE, [{ role: 'user', parts: [] }])).toBe(
      BUDGET_REACHED_MESSAGE,
    )
  })

  it('copes with a body nothing has validated yet', () => {
    expect(limitMessage(BUDGET_REACHED_MESSAGE, [])).toBe(BUDGET_REACHED_MESSAGE)
    expect(limitMessage(BUDGET_REACHED_MESSAGE, ['nonsense', null])).toBe(BUDGET_REACHED_MESSAGE)
  })
})
