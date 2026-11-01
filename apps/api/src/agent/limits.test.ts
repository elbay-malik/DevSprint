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
  DEFAULT_DAILY_TOKEN_CAP,
  limitMessage,
  rateLimitKey,
  resolveDailyTokenCap,
  messageOnlyResponse,
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
