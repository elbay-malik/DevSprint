import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  APPROVAL_SECRET_VAR,
  resetApprovalSigningState,
  resolveApprovalSecret,
  settleApprovals,
} from './approvals'
import { createLocalWorkspaceApi, createWorkspaceStore } from '../workspace/store'

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
    resetApprovalSigningState()
    vi.restoreAllMocks()
  })

  it('uses the configured secret', () => {
    expect(resolveApprovalSecret('  s3cret  ')).toBe('s3cret')
  })

  it('resets the warn-once latch too, so the warning is not order-dependent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    resolveApprovalSecret(undefined)
    expect(warn).toHaveBeenCalledTimes(1)

    // Without clearing the latch, whichever test ran first would swallow the
    // warning for every test after it.
    resetApprovalSigningState()
    warn.mockClear()
    resolveApprovalSecret(undefined)

    expect(warn).toHaveBeenCalledTimes(1)
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
  /** A fresh in-memory ledger per test — the production one lives in the workspace (ADR-0014). */
  function workspace() {
    return createLocalWorkspaceApi(createWorkspaceStore())
  }

  /** The approval object as the request carries it, after settling. */
  function approvalOf(message: UIMessage): { approved?: boolean; reason?: string } {
    const part = message.parts[0] as { approval: { approved?: boolean; reason?: string } }
    return part.approval
  }

  it('lets an approval through the first time', async () => {
    const message = pending('a1')
    await expect(settleApprovals([message], workspace())).resolves.toEqual({ replayed: 0 })
    expect(approvalOf(message).approved).toBe(true)
  })

  it('turns a reused approval into a denial instead of executing it again', async () => {
    const ws = workspace()
    await settleApprovals([pending('a1')], ws)

    const replay = pending('a1')
    await expect(settleApprovals([replay], ws)).resolves.toEqual({ replayed: 1 })
    // The write does not run twice, which is the property that matters.
    expect(approvalOf(replay).approved).toBe(false)
    expect(approvalOf(replay).reason).toContain('already used')
  })

  it('keeps the conversation usable after a reuse', async () => {
    // Refusing the whole request instead would strand the caller: the answered
    // parts stay in the transcript, so every later message would carry them
    // and be refused.
    const ws = workspace()
    await settleApprovals([pending('a1')], ws)
    const stale = pending('a1')
    const fresh = pending('a2')

    await expect(settleApprovals([stale, fresh], ws)).resolves.toEqual({ replayed: 1 })

    expect(approvalOf(stale).approved).toBe(false)
    expect(approvalOf(fresh).approved).toBe(true)
  })

  it('refuses a batch that repeats one approval id', async () => {
    // Two calls quoting the same approval would otherwise both execute on a
    // single human decision.
    const first = pending('a1')
    const duplicate = pending('a1')

    await expect(settleApprovals([first, duplicate], workspace())).resolves.toEqual({
      replayed: 1,
    })

    expect(approvalOf(first).approved).toBe(true)
    expect(approvalOf(duplicate).approved).toBe(false)
  })

  it('ignores approvals whose call already produced a result', async () => {
    // Answered approvals stay in the transcript; spending them again would
    // downgrade settled history on every later message.
    const ws = workspace()
    await expect(settleApprovals([executed('a1')], ws)).resolves.toEqual({ replayed: 0 })
    await expect(settleApprovals([executed('a1')], ws)).resolves.toEqual({ replayed: 0 })
  })

  it('spends every approval of a batch (S-B sends five at once)', async () => {
    const ws = workspace()
    await expect(
      settleApprovals([pending('a1'), pending('a2'), pending('a3')], ws),
    ).resolves.toEqual({ replayed: 0 })
    await expect(
      settleApprovals([pending('a1'), pending('a2'), pending('a3')], ws),
    ).resolves.toEqual({ replayed: 3 })
  })

  it('is unbothered by messages with no approvals', async () => {
    const plain = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage
    await expect(settleApprovals([plain], workspace())).resolves.toEqual({ replayed: 0 })
  })

  it('does not call the workspace at all when there is nothing to spend', async () => {
    // Not just an optimisation: it is what keeps the previous test's assertion
    // true without a workspace fake that tolerates being asked to spend zero ids.
    const plain = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage
    const spendApprovals = vi.fn().mockResolvedValue([])

    await settleApprovals([plain], { spendApprovals })

    expect(spendApprovals).not.toHaveBeenCalled()
  })

  it('survives a reset: a reset ledger no longer remembers what it spent', async () => {
    // reset() clears the ledger along with the board (ADR-0014) — this is the
    // seam that guarantees it, exercised the same way apps/api/src/approval-flow.test.ts
    // relies on it in `beforeEach`.
    const store = createWorkspaceStore()
    const ws = createLocalWorkspaceApi(store)
    await settleApprovals([pending('a1')], ws)

    store.reset()

    await expect(settleApprovals([pending('a1')], ws)).resolves.toEqual({ replayed: 0 })
  })
})
