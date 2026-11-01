import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  APPROVAL_SECRET_VAR,
  dropUnusableApprovals,
  hasTooManyApprovals,
  MAX_APPROVALS_PER_REQUEST,
  resetApprovalSigningState,
  resolveApprovalSecret,
  settleApprovals,
} from './approvals'
import { createLocalWorkspaceApi, createWorkspaceStore } from '../workspace/store'

/** A gated call that has been answered but not yet executed. */
function answered(approvalId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool-update_issue_status',
    toolCallId: `call-${approvalId}`,
    state: 'approval-responded',
    input: { issueKey: 'DS-7', status: 'done' },
    approval: { id: approvalId, approved: true, signature: 'sig' },
    ...overrides,
  }
}

/** An assistant turn holding one card per id, all answered and none executed. */
function pending(...approvalIds: string[]): UIMessage {
  return {
    id: `m-${approvalIds.join('-')}`,
    role: 'assistant',
    parts: approvalIds.map((id) => answered(id)),
  } as unknown as UIMessage
}

const user = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage

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
  function approvalOf(message: UIMessage, index = 0): { approved?: boolean; reason?: string } {
    const part = message.parts[index] as { approval: { approved?: boolean; reason?: string } }
    return part.approval
  }

  /** A ledger that records what it was asked to spend and has spent nothing. */
  function spy() {
    return { spendApprovals: vi.fn().mockResolvedValue([]) }
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
    const message = pending('a1', 'a2')

    await expect(settleApprovals([message], ws)).resolves.toEqual({ replayed: 1 })

    expect(approvalOf(message, 0).approved).toBe(false)
    expect(approvalOf(message, 1).approved).toBe(true)
  })

  it('refuses a batch that repeats one approval id', async () => {
    // Two calls quoting the same approval would otherwise both execute on a
    // single human decision.
    const message = pending('a1', 'a1')

    await expect(settleApprovals([message], workspace())).resolves.toEqual({ replayed: 1 })

    expect(approvalOf(message, 0).approved).toBe(true)
    expect(approvalOf(message, 1).approved).toBe(false)
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
    await expect(settleApprovals([pending('a1', 'a2', 'a3')], ws)).resolves.toEqual({
      replayed: 0,
    })
    await expect(settleApprovals([pending('a1', 'a2', 'a3')], ws)).resolves.toEqual({
      replayed: 3,
    })
  })

  it('is unbothered by messages with no approvals', async () => {
    const plain = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage
    await expect(settleApprovals([plain], workspace())).resolves.toEqual({ replayed: 0 })
  })

  it('ignores an oversized id rather than persisting it', async () => {
    // Signature verification — the actual defence against a forged id — runs
    // later, inside the agent loop. settleApprovals runs first and touches the
    // ledger before anything has checked the id is real, so an attacker who
    // never had a valid signature could still use a huge id to make a
    // storage write fail, denying the ledger to every later chat until the
    // next reset. This id never reaches spendApprovals at all.
    const spendApprovals = vi.fn().mockResolvedValue([])
    const huge = pending('a'.repeat(10_000))

    await settleApprovals([huge], { spendApprovals })

    expect(spendApprovals).not.toHaveBeenCalled()
  })

  it('does not call the workspace at all when there is nothing to spend', async () => {
    // Not just an optimisation: it is what keeps the previous test's assertion
    // true without a workspace fake that tolerates being asked to spend zero ids.
    const plain = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as UIMessage
    const spendApprovals = vi.fn().mockResolvedValue([])

    await settleApprovals([plain], { spendApprovals })

    expect(spendApprovals).not.toHaveBeenCalled()
  })

  it('spends an approval in an earlier message of the same turn', async () => {
    // A trailing message holding only a step-start converts to nothing, so the
    // approval before it is the last thing the model sees and it executes. A
    // scan of the last message alone would never spend it.
    const ledger = spy()
    const trailing = { id: 'a2', role: 'assistant', parts: [{ type: 'step-start' }] } as UIMessage

    await settleApprovals([user, pending('a1'), trailing], ledger)

    expect(ledger.spendApprovals).toHaveBeenCalledWith(['a1'])
  })

  it('never spends ids from before the latest user message', async () => {
    // Nothing can execute from there, so they could only flush the ledger.
    const ledger = spy()

    await settleApprovals([user, pending('junk1'), { ...user, id: 'u2' }], ledger)

    expect(ledger.spendApprovals).not.toHaveBeenCalled()
  })

  it('keeps junk away from the ledger', async () => {
    // None of these can run: read tools are never signed and an unsigned
    // approval is refused. Each one spent would still push a real id towards
    // eviction.
    const ledger = spy()
    const junk = {
      id: 'a1',
      role: 'assistant',
      parts: [
        answered('read-tool', { type: 'tool-list_issues' }),
        answered('dynamic', { type: 'dynamic-tool', toolName: 'update_issue_status' }),
        answered('unsigned', { approval: { id: 'unsigned', approved: true } }),
      ],
    } as unknown as UIMessage

    await settleApprovals([user, junk], ledger)

    expect(ledger.spendApprovals).not.toHaveBeenCalled()
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

describe('hasTooManyApprovals', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `a${index}`)

  it('allows a step as large as the board', () => {
    expect(hasTooManyApprovals([user, pending(...ids(MAX_APPROVALS_PER_REQUEST))])).toBe(false)
  })

  it('refuses more, wherever in the turn they sit', () => {
    const half = Math.ceil((MAX_APPROVALS_PER_REQUEST + 1) / 2)
    const rest = ids(half).map((id) => `b${id}`)
    expect(hasTooManyApprovals([user, pending(...ids(half)), pending(...rest)])).toBe(true)
  })

  it('does not count approvals from earlier turns, which it will not spend', () => {
    const old = pending(...ids(MAX_APPROVALS_PER_REQUEST + 1))
    expect(hasTooManyApprovals([user, old, { ...user, id: 'u2' }])).toBe(false)
  })
})

describe('dropUnusableApprovals', () => {
  const later = { ...user, id: 'u2' }

  it('removes a card the person has moved on from, and keeps the rest of its message', () => {
    const message = {
      id: 'a1',
      role: 'assistant',
      parts: [answered('a1'), { type: 'text', text: 'limit reached' }],
    } as unknown as UIMessage

    const [, kept] = dropUnusableApprovals([user, message, later])

    expect(kept?.parts).toEqual([{ type: 'text', text: 'limit reached' }])
    // The request's copy is what is trimmed. Nothing else should see it change.
    expect(message.parts).toHaveLength(2)
  })

  it('keeps the card this request is resuming', () => {
    const message = pending('a1')
    expect(dropUnusableApprovals([user, message])[1]).toBe(message)
  })

  it('keeps calls that already ran, which are real history', () => {
    const message = executed('a1')
    expect(dropUnusableApprovals([user, message, later])[1]).toBe(message)
  })

  it('removes an answered dynamic tool part, which the ledger would not see', () => {
    const message = {
      id: 'a1',
      role: 'assistant',
      parts: [answered('a1', { type: 'dynamic-tool', toolName: 'update_issue_status' })],
    } as unknown as UIMessage

    expect(dropUnusableApprovals([user, message])[1]?.parts).toEqual([])
  })
})
