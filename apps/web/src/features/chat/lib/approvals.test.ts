import { describe, expect, it } from 'vitest'
import {
  approvalOutcome,
  approvalOutcomeLine,
  changesNeedApproval,
  pendingApprovalCount,
} from './approvals'

describe('approvalOutcome', () => {
  it('has nothing to say while the card is still asking', () => {
    expect(approvalOutcome({ state: 'approval-requested', approval: {} })).toBeUndefined()
  })

  it('records an approval the moment it is given, before the write has run', () => {
    // The status line announces the decision right away, so it has to have
    // words for it before the continued turn brings the result back.
    expect(
      approvalOutcome({ state: 'approval-responded', approval: { approved: true } })?.text,
    ).toBe('Approved by you.')
  })

  it('adds how the write went once it has', () => {
    expect(
      approvalOutcome({
        state: 'output-available',
        approval: { approved: true },
        output: { ok: true, data: {} },
      })?.text,
    ).toBe('Approved by you — applied.')
  })

  it('quotes the reason a change was denied for', () => {
    expect(
      approvalOutcome({ state: 'output-denied', approval: { approved: false, reason: 'Blocked' } })
        ?.text,
    ).toBe('Denied: “Blocked”.')
    expect(approvalOutcome({ state: 'output-denied', approval: { approved: false } })?.text).toBe(
      'Denied.',
    )
  })

  it('reads a failed write as failed, with the code as detail', () => {
    const outcome = approvalOutcome({
      state: 'output-available',
      approval: { approved: true },
      output: { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: 'No such issue.' } },
    })
    expect(outcome).toEqual({
      failed: true,
      text: 'Approved by you, but it failed: No such issue.',
      code: 'ISSUE_NOT_FOUND',
    })
    expect(approvalOutcomeLine(outcome!)).toBe(
      'Approved by you, but it failed: No such issue. (ISSUE_NOT_FOUND)',
    )
  })
})

describe('pendingApprovalCount', () => {
  it('counts only the cards still asking', () => {
    expect(
      pendingApprovalCount([
        { type: 'text', text: 'Five changes:' },
        { state: 'approval-requested' },
        { state: 'approval-responded' },
        { state: 'approval-requested' },
      ]),
    ).toBe(2)
    expect(pendingApprovalCount(undefined)).toBe(0)
  })
})

describe('changesNeedApproval', () => {
  it('agrees with its count', () => {
    expect(changesNeedApproval(1)).toBe('1 change needs your approval.')
    expect(changesNeedApproval(5)).toBe('5 changes need your approval.')
  })
})
