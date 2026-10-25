import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import {
  approveAllLabel,
  approveAllPlan,
  approvedTogether,
  needOwnDecision,
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
    ).toBe('Denied by you: “Blocked”.')
    expect(approvalOutcome({ state: 'output-denied', approval: { approved: false } })?.text).toBe(
      'Denied by you.',
    )
  })

  it('records a typed failure briefly, since the ErrorCard below it explains', () => {
    // S-E said the failure three times: here, on the ErrorCard and in the reply.
    const outcome = approvalOutcome(
      {
        state: 'output-available',
        approval: { approved: true },
        output: { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: 'No such issue.' } },
      },
      '14:02',
    )
    expect(outcome).toEqual({
      failed: true,
      mark: '✕',
      text: 'Approved by you at 14:02 — not applied',
      code: 'ISSUE_NOT_FOUND',
    })
    expect(approvalOutcomeLine(outcome!)).toBe(
      'Approved by you at 14:02 — not applied (ISSUE_NOT_FOUND).',
    )
  })

  it('keeps the reason for a call that threw, since no ErrorCard follows it', () => {
    const outcome = approvalOutcome({
      state: 'output-error',
      approval: { approved: true },
      errorText: 'Tool execution timed out',
    })
    expect(outcome).toEqual({
      failed: true,
      mark: '✕',
      text: 'Approved by you, but it failed: Tool execution timed out',
    })
  })

  it('adds the time of the decision when it is known', () => {
    const applied = {
      state: 'output-available',
      approval: { approved: true },
      output: { ok: true, data: {} },
    }
    expect(approvalOutcome(applied, '14:02')?.text).toBe('Approved by you at 14:02 — applied.')
    expect(
      approvalOutcome({ state: 'approval-responded', approval: { approved: true } }, '09:15')?.text,
    ).toBe('Approved by you at 09:15.')
    expect(
      approvalOutcome(
        { state: 'output-denied', approval: { approved: false, reason: 'Blocked' } },
        '14:03',
      )?.text,
    ).toBe('Denied by you at 14:03: “Blocked”.')
  })

  it('leads with a glyph from the deployment card’s language', () => {
    const deployment = (status: string) => ({
      state: 'output-available',
      approval: { approved: true },
      output: { ok: true, data: { deployment: { status } } },
    })
    expect(
      approvalOutcome({
        state: 'output-available',
        approval: { approved: true },
        output: { ok: true, data: {} },
      })?.mark,
    ).toBe('●')
    expect(
      approvalOutcome({ state: 'approval-responded', approval: { approved: true } })?.mark,
    ).toBe('◐')
    expect(approvalOutcome({ state: 'output-denied', approval: { approved: false } })?.mark).toBe(
      '–',
    )
    expect(approvalOutcome(deployment('running'))?.mark).toBe('◐')
    expect(approvalOutcome(deployment('succeeded'))?.mark).toBe('●')
    expect(approvalOutcome(deployment('cancelled'))).toMatchObject({ mark: '–', failed: false })
    expect(approvalOutcome(deployment('failed'))).toMatchObject({
      mark: '✕',
      failed: true,
      text: 'Approved by you — deployment failed.',
    })
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

describe('approveAllPlan', () => {
  const status = (id: string, issueKey: string, state = 'approval-requested') => ({
    type: 'tool-update_issue_status',
    toolCallId: id,
    state,
    input: { issueKey, status: 'done' },
    approval: { id: `a-${id}` },
  })

  it('answers the open board writes, each with the status it moves from', () => {
    const plan = approveAllPlan(
      [
        { type: 'text', text: 'Five to close.' },
        status('c1', 'DS-7'),
        status('c2', ' ds-9 '),
        {
          type: 'tool-create_issue',
          toolCallId: 'c3',
          state: 'approval-requested',
          input: { title: 'Retry webhooks', type: 'task' },
          approval: { id: 'a-c3' },
        },
        // An ungated read is not part of any decision.
        { type: 'tool-list_issues', toolCallId: 'c4', state: 'output-available', input: {} },
      ],
      issues,
    )
    expect(plan).toEqual({
      approvals: [
        { toolCallId: 'c1', approvalId: 'a-c1', from: 'in_review' },
        { toolCallId: 'c2', approvalId: 'a-c2', from: 'in_progress' },
        { toolCallId: 'c3', approvalId: 'a-c3' },
      ],
      excluded: [],
      remaining: false,
    })
  })

  it('leaves deploys, release notes and keys the board does not hold to their own cards', () => {
    const plan = approveAllPlan(
      [
        status('c1', 'DS-7'),
        status('c2', 'DS-42'),
        {
          type: 'dynamic-tool',
          toolName: 'run_deployment',
          toolCallId: 'c3',
          state: 'approval-requested',
          input: { version: 'v1.5.0', environment: 'staging' },
          approval: { id: 'a-c3' },
        },
        {
          type: 'tool-create_release_notes',
          toolCallId: 'c4',
          state: 'approval-requested',
          input: { version: 'v1.5.0', markdown: '# v1.5.0' },
          approval: { id: 'a-c4' },
        },
      ],
      issues,
    )
    expect(plan.approvals.map((approval) => approval.toolCallId)).toEqual(['c1'])
    expect(plan.excluded).toEqual([
      [{ id: 'DS-42' }],
      ['deploying ', { id: 'v1.5.0' }, ' to ', { id: 'staging' }],
      ['saving the ', { id: 'v1.5.0' }, ' release notes'],
    ])
  })

  it('knows when some cards were already answered one by one', () => {
    const plan = approveAllPlan(
      [status('c1', 'DS-11', 'approval-responded'), status('c2', 'DS-7'), status('c3', 'DS-8')],
      issues,
    )
    expect(plan.remaining).toBe(true)
    expect(plan.approvals).toHaveLength(2)
  })
})

describe('the Approve all copy', () => {
  it('counts exactly what it answers, and says when it is the rest', () => {
    expect(approveAllLabel(5, false)).toBe('Approve all 5')
    expect(approveAllLabel(4, true)).toBe('Approve remaining 4')
  })

  it('names what it leaves, in a sentence that reads whole', () => {
    const text = (parts: ReturnType<typeof needOwnDecision>) =>
      parts.map((part) => (typeof part === 'string' ? part : part.id)).join('')
    expect(needOwnDecision([])).toEqual([])
    expect(text(needOwnDecision([[{ id: 'DS-42' }]]))).toBe('DS-42 needs its own decision.')
    expect(text(needOwnDecision([['deploying ', { id: 'v1.5.0' }]]))).toBe(
      'Deploying v1.5.0 needs its own decision.',
    )
    expect(
      text(
        needOwnDecision([
          [{ id: 'DS-42' }],
          [{ id: 'DS-43' }],
          ['saving the ', { id: 'v1.5.0' }, ' release notes'],
        ]),
      ),
    ).toBe('DS-42, DS-43 and saving the v1.5.0 release notes need their own decisions.')
  })

  it('says one press as one line', () => {
    expect(approvedTogether(4, '14:05')).toBe('4 changes approved by you at 14:05.')
    expect(approvedTogether(2)).toBe('2 changes approved by you.')
  })
})
