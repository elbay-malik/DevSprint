import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  APPROVAL_SECRET_VAR,
  resetApprovalLedger,
  resolveApprovalSecret,
  settleApprovals,
} from './approvals'

/** An assistant turn whose gated call is answered but not yet executed. */
function pending(approvalId: string): UIMessage {
  return {
    id: `m-${approvalId}`,
    role: 'assistant',
    parts: [
      {
        type: 'tool-update_issue_status',
        toolCallId: `call-${approvalId}`,
        state: 'approval-responded',
        input: { issueKey: 'DS-7', status: 'done' },
        approval: { id: approvalId, approved: true, signature: 'sig' },
      },
    ],
  } as unknown as UIMessage
}

/** The same call once it has run — it stays in the transcript forever. */
function executed(approvalId: string): UIMessage {
  return {
    id: `m-${approvalId}`,
    role: 'assistant',
    parts: [
      {
        type: 'tool-update_issue_status',
        toolCallId: `call-${approvalId}`,
        state: 'output-available',
        input: { issueKey: 'DS-7', status: 'done' },
        output: { ok: true, data: {} },
        approval: { id: approvalId, approved: true, signature: 'sig' },
      },
    ],
  } as unknown as UIMessage
}

describe('resolveApprovalSecret', () => {
  beforeEach(() => {
    resetApprovalLedger()
    vi.restoreAllMocks()
  })

  it('uses the configured secret', () => {
    expect(resolveApprovalSecret('  s3cret  ')).toBe('s3cret')
  })

  it('never runs unsigned: an unset secret still yields one, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const first = resolveApprovalSecret(undefined)
    const second = resolveApprovalSecret('   ')

    expect(first).toHaveLength(36)
    // Stable within the isolate, or approvals issued moments ago would not verify.
    expect(second).toBe(first)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain(APPROVAL_SECRET_VAR)
  })
})

describe('settleApprovals', () => {
  beforeEach(() => {
    resetApprovalLedger()
  })

  /** The approval object as the request carries it, after settling. */
  function approvalOf(message: UIMessage): { approved?: boolean; reason?: string } {
    const part = message.parts[0] as { approval: { approved?: boolean; reason?: string } }
    return part.approval
  }

  it('lets an approval through the first time', () => {
    const message = pending('a1')
    expect(settleApprovals([message])).toEqual({ replayed: 0 })
    expect(approvalOf(message).approved).toBe(true)
  })

  it('turns a reused approval into a denial instead of executing it again', () => {
    settleApprovals([pending('a1')])

    const replay = pending('a1')
    expect(settleApprovals([replay])).toEqual({ replayed: 1 })
    // The write does not run twice, which is the property that matters.
    expect(approvalOf(replay).approved).toBe(false)
    expect(approvalOf(replay).reason).toContain('already used')
  })

  it('keeps the conversation usable after a reuse', () => {
    // Refusing the whole request would strand the caller: the answered parts stay
    // in the transcript, so every later message would carry them and be refused.
    settleApprovals([pending('a1')])
    const stale = pending('a1')
    const fresh = pending('a2')

    expect(settleApprovals([stale, fresh])).toEqual({ replayed: 1 })

    expect(approvalOf(stale).approved).toBe(false)
    expect(approvalOf(fresh).approved).toBe(true)
  })

  it('refuses a batch that repeats one approval id', () => {
    // Two calls quoting the same approval would otherwise both execute on a
    // single human decision.
    const first = pending('a1')
    const duplicate = pending('a1')

    expect(settleApprovals([first, duplicate])).toEqual({ replayed: 1 })

    expect(approvalOf(first).approved).toBe(true)
    expect(approvalOf(duplicate).approved).toBe(false)
  })

  it('ignores approvals whose call already produced a result', () => {
    // Answered approvals stay in the transcript; spending them again would
    // downgrade settled history on every later message.
    expect(settleApprovals([executed('a1')])).toEqual({ replayed: 0 })
    expect(settleApprovals([executed('a1')])).toEqual({ replayed: 0 })
  })

  it('spends every approval of a batch (S-B sends five at once)', () => {
    expect(settleApprovals([pending('a1'), pending('a2'), pending('a3')])).toEqual({ replayed: 0 })
    expect(settleApprovals([pending('a1'), pending('a2'), pending('a3')])).toEqual({ replayed: 3 })
  })

  it('is unbothered by messages with no approvals', () => {
    const plain = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage
    expect(settleApprovals([plain])).toEqual({ replayed: 0 })
  })
})
