import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import {
  approvalOutcome,
  approvalOutcomeLine,
  approvalStateSignature,
  changesNeedApproval,
  changesToReview,
  isSettledApproval,
  parseApprovalStates,
  pendingApprovalCount,
  pendingStatusMoves,
} from './approvals'

const { issues } = createWorkspaceSeed()

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

describe('pendingStatusMoves', () => {
  const statusChange = (issueKey: string, status: string, state = 'approval-requested') => ({
    type: 'tool-update_issue_status',
    toolCallId: `call-${issueKey}`,
    state,
    input: { issueKey, status },
    approval: { id: `a-${issueKey}` },
  })

  it('maps each open status change to the issue it would move and where', () => {
    const moves = pendingStatusMoves(
      [
        { type: 'text', text: 'Closing out.' },
        statusChange('DS-7', 'done'),
        statusChange('DS-11', 'done'),
      ],
      issues,
    )
    expect([...moves]).toEqual([
      ['DS-7', 'done'],
      ['DS-11', 'done'],
    ])
  })

  it('drops a change once it is answered, and ignores writes with no card on the board', () => {
    const moves = pendingStatusMoves(
      [
        statusChange('DS-7', 'done', 'approval-responded'),
        {
          type: 'tool-create_issue',
          toolCallId: 'c2',
          state: 'approval-requested',
          input: { title: 'New one', type: 'feature' },
          approval: { id: 'a2' },
        },
        statusChange('DS-42', 'done'),
      ],
      issues,
    )
    expect(moves.size).toBe(0)
  })

  it('keys a lowercase or padded key by the board’s own spelling, as the api finds it', () => {
    const moves = pendingStatusMoves(
      [statusChange('ds-7', 'done'), statusChange('  DS-11 ', 'blocked')],
      issues,
    )
    expect([...moves]).toEqual([
      ['DS-7', 'done'],
      ['DS-11', 'blocked'],
    ])
  })

  it('reads a dynamic tool part by its tool name', () => {
    const moves = pendingStatusMoves(
      [
        {
          type: 'dynamic-tool',
          toolName: 'update_issue_status',
          toolCallId: 'c1',
          state: 'approval-requested',
          input: { issueKey: 'DS-9', status: 'in_review' },
        },
      ],
      issues,
    )
    expect(moves.get('DS-9')).toBe('in_review')
  })

  it('has nothing pending for a message with no parts', () => {
    expect(pendingStatusMoves(undefined, issues).size).toBe(0)
  })
})

describe('approvalStateSignature', () => {
  const gated = (id: string, state: string) => ({
    type: 'tool-update_issue_status',
    toolCallId: id,
    state,
    approval: { id: `a-${id}` },
  })

  it('is the same primitive for the same states, so a streamed chunk does not trigger a watcher', () => {
    const before = approvalStateSignature([gated('c1', 'approval-requested')])
    const after = approvalStateSignature([
      gated('c1', 'approval-requested'),
      { type: 'text', text: 'One more token' },
      { type: 'tool-get_sprint_status', toolCallId: 'r1', state: 'input-available' },
    ])
    expect(typeof before).toBe('string')
    expect(Object.is(before, after)).toBe(true)
  })

  it('changes when a state does, and reads back in transcript order', () => {
    const asked = approvalStateSignature([
      gated('c1', 'approval-requested'),
      gated('c2', 'approval-requested'),
    ])
    const answered = approvalStateSignature([
      gated('c1', 'approval-requested'),
      gated('c2', 'approval-responded'),
    ])
    expect(answered).not.toBe(asked)
    expect([...parseApprovalStates(answered)]).toEqual([
      ['c1', 'approval-requested'],
      ['c2', 'approval-responded'],
    ])
    expect(parseApprovalStates(approvalStateSignature(undefined)).size).toBe(0)
  })
})

describe('isSettledApproval', () => {
  it('is true only for a gated call that has run, either way', () => {
    const approval = { id: 'a1', approved: true }
    expect(isSettledApproval({ state: 'output-available', approval })).toBe(true)
    expect(isSettledApproval({ state: 'output-error', approval })).toBe(true)
    expect(isSettledApproval({ state: 'approval-responded', approval })).toBe(false)
    expect(isSettledApproval({ state: 'output-denied', approval })).toBe(false)
    // An ungated read has no approval to report.
    expect(isSettledApproval({ state: 'output-available' })).toBe(false)
  })
})

describe('changesToReview', () => {
  it('counts the open changes and what they weigh', () => {
    expect(changesToReview(5, 23)).toBe('5 changes to review · 23 pts')
    expect(changesToReview(1, 1)).toBe('1 change to review · 1 pt')
  })

  it('leaves the points off when none of the changes carries any', () => {
    expect(changesToReview(2, 0)).toBe('2 changes to review')
  })
})
