import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import {
  CHANGES_MAX,
  MAX_CHANGE_ID_LENGTH,
  appendChange,
  assignIssueTracked,
  createIssueTracked,
  undoChange,
  updateIssueStatusTracked,
  type BoardChange,
} from './changes'
import { assignIssue, createReleaseNotes, updateIssueStatus } from './mutations'

const AT = '2026-10-25T14:05:00.000Z'

function issue(workspace: Workspace, key: string) {
  return workspace.issues.find((candidate) => candidate.key === key)
}

function errorCode(result: { ok: boolean; error?: { code: string } }) {
  return result.ok ? undefined : result.error?.code
}

describe('recording a board write', () => {
  it('takes the before-state off the board as the write lands', () => {
    const workspace = createWorkspaceSeed()
    const seeded = structuredClone(issue(workspace, 'DS-7')!)

    const { result, changes } = updateIssueStatusTracked(
      workspace,
      { issueKey: 'ds-7', status: 'done' },
      { changes: [], changeId: 'c-1', at: AT },
    )

    expect(result.ok && result.data.changeId).toBe('c-1')
    expect(changes).toEqual([
      {
        id: 'c-1',
        tool: 'update_issue_status',
        issueKey: 'DS-7',
        before: {
          status: seeded.status,
          assigneeId: seeded.assigneeId,
          blockedReason: seeded.blockedReason,
          completedAt: seeded.completedAt,
        },
        after: {
          status: 'done',
          assigneeId: seeded.assigneeId,
          blockedReason: null,
          completedAt: workspace.now,
        },
        appliedAt: AT,
        undoneAt: null,
      },
    ])
  })

  it('records a created issue with no before-state', () => {
    const workspace = createWorkspaceSeed()
    const { result, changes } = createIssueTracked(
      workspace,
      { title: 'Flaky login test', type: 'bug', priority: 'high', sprintId: null },
      { changes: [], changeId: 'c-1', at: AT },
    )
    expect(result.ok && result.data.changeId).toBe('c-1')
    expect(changes?.[0]).toMatchObject({
      tool: 'create_issue',
      before: null,
      after: { status: 'todo' },
    })
  })

  it('records an assignment with the assignee it replaced', () => {
    const workspace = createWorkspaceSeed()

    const { result, changes } = assignIssueTracked(
      workspace,
      { issueKey: 'ds-12', assigneeId: 'u-dana' },
      { changes: [], changeId: 'c-1', at: AT },
    )

    expect(result.ok && result.data.changeId).toBe('c-1')
    expect(changes).toEqual([
      {
        id: 'c-1',
        tool: 'assign_issue',
        issueKey: 'DS-12',
        before: { status: 'todo', assigneeId: null, blockedReason: null, completedAt: null },
        after: { status: 'todo', assigneeId: 'u-dana', blockedReason: null, completedAt: null },
        appliedAt: AT,
        undoneAt: null,
      },
    ])
  })

  it('records nothing for an assignment that was refused', () => {
    const workspace = createWorkspaceSeed()
    const track = { changes: [], changeId: 'c-1', at: AT }
    for (const [input, code] of [
      [{ issueKey: 'DS-999', assigneeId: 'u-dana' }, 'ISSUE_NOT_FOUND'],
      [{ issueKey: 'DS-12', assigneeId: 'u-zoe' }, 'USER_NOT_FOUND'],
      [{ issueKey: 'DS-12', assigneeId: null }, 'INVALID_INPUT'],
    ] as const) {
      const refused = assignIssueTracked(workspace, input, track)
      expect(errorCode(refused.result), input.issueKey).toBe(code)
      expect(refused.changes).toBeUndefined()
    }
  })

  it('records nothing for a write that failed', () => {
    const workspace = createWorkspaceSeed()
    const missing = updateIssueStatusTracked(
      workspace,
      { issueKey: 'DS-999', status: 'done' },
      { changes: [], changeId: 'c-1', at: AT },
    )
    expect(errorCode(missing.result)).toBe('ISSUE_NOT_FOUND')
    expect(missing.changes).toBeUndefined()
  })

  it('keeps the journal bounded, oldest out first', () => {
    let changes: BoardChange[] = []
    for (let i = 0; i < CHANGES_MAX + 5; i += 1) {
      changes = appendChange(changes, {
        id: `c-${i}`,
        tool: 'create_issue',
        issueKey: `DS-${i}`,
        before: null,
        after: { status: 'todo', assigneeId: null, blockedReason: null, completedAt: null },
        appliedAt: AT,
        undoneAt: null,
      })
    }
    expect(changes).toHaveLength(CHANGES_MAX)
    expect(changes[0]!.id).toBe('c-5')
  })
})

describe('undoing a recorded write', () => {
  function statusChange(status: 'done' | 'blocked' = 'done', comment?: string) {
    const workspace = createWorkspaceSeed()
    const { changes } = updateIssueStatusTracked(
      workspace,
      { issueKey: 'DS-7', status, ...(comment === undefined ? {} : { comment }) },
      { changes: [], changeId: 'c-1', at: AT },
    )
    return { workspace, changes: changes! }
  }

  it('puts a status change back, completion included', () => {
    const seeded = issue(createWorkspaceSeed(), 'DS-7')!
    const { workspace, changes } = statusChange()

    const { result, changes: next } = undoChange(workspace, changes, 'c-1', AT)

    expect(result).toMatchObject({
      ok: true,
      data: { changeId: 'c-1', issueKey: 'DS-7', outcome: 'restored', undoneAt: AT },
    })
    expect(result.ok && result.data.issue?.status).toBe(seeded.status)
    expect(issue(workspace, 'DS-7')).toMatchObject({
      status: seeded.status,
      completedAt: seeded.completedAt,
      blockedReason: seeded.blockedReason,
    })
    expect(next?.[0]!.undoneAt).toBe(AT)
  })

  it('clears a blocked reason the write added', () => {
    const { workspace, changes } = statusChange('blocked', 'waiting on infra')
    expect(issue(workspace, 'DS-7')!.blockedReason).toBe('waiting on infra')

    undoChange(workspace, changes, 'c-1', AT)

    expect(issue(workspace, 'DS-7')!.blockedReason).toBeNull()
  })

  it('removes a created issue', () => {
    const workspace = createWorkspaceSeed()
    const created = createIssueTracked(
      workspace,
      { title: 'Flaky login test', type: 'bug', priority: 'high', sprintId: null },
      { changes: [], changeId: 'c-1', at: AT },
    )
    const key = created.result.ok ? created.result.data.issue.key : ''
    expect(issue(workspace, key)).toBeDefined()

    const { result } = undoChange(workspace, created.changes!, 'c-1', AT)

    expect(result).toMatchObject({ ok: true, data: { outcome: 'removed', issue: null } })
    expect(issue(workspace, key)).toBeUndefined()
    expect(workspace.issues).toHaveLength(createWorkspaceSeed().issues.length)
  })

  it('is one-shot', () => {
    const { workspace, changes } = statusChange()
    const first = undoChange(workspace, changes, 'c-1', AT)

    const second = undoChange(workspace, first.changes!, 'c-1', AT)

    expect(errorCode(second.result)).toBe('UNDO_CONFLICT')
    expect(second.result.ok === false && second.result.error.message).toMatch(/already undone/)
    expect(second.changes).toBeUndefined()
  })

  it('refuses once the issue has changed since, and leaves it alone', () => {
    const { workspace, changes } = statusChange()
    updateIssueStatus(workspace, { issueKey: 'DS-7', status: 'in_progress' })

    const { result, changes: next } = undoChange(workspace, changes, 'c-1', AT)

    expect(errorCode(result)).toBe('UNDO_CONFLICT')
    expect(issue(workspace, 'DS-7')!.status).toBe('in_progress')
    expect(next).toBeUndefined()
  })

  it('refuses to remove a created issue someone has since moved', () => {
    const workspace = createWorkspaceSeed()
    const created = createIssueTracked(
      workspace,
      { title: 'Flaky login test', type: 'bug', priority: 'high', sprintId: null },
      { changes: [], changeId: 'c-1', at: AT },
    )
    const key = created.result.ok ? created.result.data.issue.key : ''
    updateIssueStatus(workspace, { issueKey: key, status: 'in_progress' })

    expect(errorCode(undoChange(workspace, created.changes!, 'c-1', AT).result)).toBe(
      'UNDO_CONFLICT',
    )
    expect(issue(workspace, key)).toBeDefined()
  })

  it('unwinds a chain in order, latest first', () => {
    const workspace = createWorkspaceSeed()
    const seeded = issue(workspace, 'DS-7')!.status
    const first = updateIssueStatusTracked(
      workspace,
      { issueKey: 'DS-7', status: 'done' },
      { changes: [], changeId: 'c-1', at: AT },
    )
    const second = updateIssueStatusTracked(
      workspace,
      { issueKey: 'DS-7', status: 'blocked' },
      { changes: first.changes!, changeId: 'c-2', at: AT },
    )

    // The earlier one cannot jump the queue...
    expect(errorCode(undoChange(workspace, second.changes!, 'c-1', AT).result)).toBe(
      'UNDO_CONFLICT',
    )
    // ...but once the later one is undone, it reads what the earlier one left.
    const undoneSecond = undoChange(workspace, second.changes!, 'c-2', AT)
    expect(issue(workspace, 'DS-7')!.status).toBe('done')
    undoChange(workspace, undoneSecond.changes!, 'c-1', AT)
    expect(issue(workspace, 'DS-7')!.status).toBe(seeded)
  })

  it('refuses while a later recorded write to the issue still stands, even if the fields match', () => {
    // A→B→A→B: the issue reads what change 1 left, but change 3 is what put it there.
    const workspace = createWorkspaceSeed()
    let changes: BoardChange[] = []
    for (const [changeId, status] of [
      ['c-1', 'done'],
      ['c-2', 'in_review'],
      ['c-3', 'done'],
    ] as const) {
      changes = updateIssueStatusTracked(
        workspace,
        { issueKey: 'DS-7', status },
        { changes, changeId, at: AT },
      ).changes!
    }

    expect(errorCode(undoChange(workspace, changes, 'c-1', AT).result)).toBe('UNDO_CONFLICT')
    expect(issue(workspace, 'DS-7')!.status).toBe('done')
    // The latest one is still undoable.
    expect(undoChange(workspace, changes, 'c-3', AT).result.ok).toBe(true)
  })

  it('never lands on a new issue that reuses a removed key', () => {
    const workspace = createWorkspaceSeed()
    const input = {
      title: 'Flaky login test',
      type: 'bug',
      priority: 'high',
      sprintId: null,
    } as const
    let changes = createIssueTracked(workspace, input, {
      changes: [],
      changeId: 'c-1',
      at: AT,
    }).changes!
    const key = changes[0]!.issueKey
    changes = updateIssueStatusTracked(
      workspace,
      { issueKey: key, status: 'in_progress' },
      { changes, changeId: 'c-2', at: AT },
    ).changes!
    changes = updateIssueStatusTracked(
      workspace,
      { issueKey: key, status: 'todo' },
      { changes, changeId: 'c-3', at: AT },
    ).changes!
    // The create cannot be undone over its own later history...
    expect(errorCode(undoChange(workspace, changes, 'c-1', AT).result)).toBe('UNDO_CONFLICT')
    // ...and once it is unwound and the key is minted again, the old records stay dead.
    for (const id of ['c-3', 'c-2', 'c-1'])
      changes = undoChange(workspace, changes, id, AT).changes!
    const reused = createIssueTracked(
      workspace,
      { ...input, title: 'Unrelated' },
      { changes, changeId: 'c-4', at: AT },
    )
    expect(reused.result.ok && reused.result.data.issue.key).toBe(key)
    changes = reused.changes!
    for (const id of ['c-1', 'c-2', 'c-3']) {
      expect(errorCode(undoChange(workspace, changes, id, AT).result), id).toBe('UNDO_CONFLICT')
    }
    expect(issue(workspace, key)).toMatchObject({ title: 'Unrelated', status: 'todo' })
  })

  it('puts an assignment back to whoever held the issue before', () => {
    const workspace = createWorkspaceSeed()
    const { changes } = assignIssueTracked(
      workspace,
      { issueKey: 'DS-7', assigneeId: 'u-chidi' },
      { changes: [], changeId: 'c-1', at: AT },
    )

    const { result } = undoChange(workspace, changes!, 'c-1', AT)

    expect(result).toMatchObject({
      ok: true,
      data: { tool: 'assign_issue', issueKey: 'DS-7', outcome: 'restored' },
    })
    expect(issue(workspace, 'DS-7')!.assigneeId).toBe('u-ben')
  })

  it('puts a first assignment back to nobody', () => {
    const workspace = createWorkspaceSeed()
    const { changes } = assignIssueTracked(
      workspace,
      { issueKey: 'DS-12', assigneeId: 'u-dana' },
      { changes: [], changeId: 'c-1', at: AT },
    )

    const { result } = undoChange(workspace, changes!, 'c-1', AT)

    expect(result.ok && result.data.issue?.assigneeId).toBeNull()
    expect(issue(workspace, 'DS-12')!.assigneeId).toBeNull()
  })

  it('puts an unassignment back to the person it took the issue from', () => {
    const workspace = createWorkspaceSeed()
    const { changes } = assignIssueTracked(
      workspace,
      { issueKey: 'DS-11', assigneeId: null },
      { changes: [], changeId: 'c-1', at: AT },
    )

    undoChange(workspace, changes!, 'c-1', AT)

    expect(issue(workspace, 'DS-11')!.assigneeId).toBe('u-dana')
  })

  it('refuses to undo an assignment under a later recorded reassignment or status change', () => {
    for (const later of ['reassign', 'status'] as const) {
      const workspace = createWorkspaceSeed()
      let changes = assignIssueTracked(
        workspace,
        { issueKey: 'DS-12', assigneeId: 'u-dana' },
        { changes: [], changeId: 'c-1', at: AT },
      ).changes!
      changes =
        later === 'reassign'
          ? assignIssueTracked(
              workspace,
              { issueKey: 'DS-12', assigneeId: 'u-ben' },
              { changes, changeId: 'c-2', at: AT },
            ).changes!
          : updateIssueStatusTracked(
              workspace,
              { issueKey: 'DS-12', status: 'in_progress' },
              { changes, changeId: 'c-2', at: AT },
            ).changes!

      expect(errorCode(undoChange(workspace, changes, 'c-1', AT).result), later).toBe(
        'UNDO_CONFLICT',
      )
      // Untouched: the later write is what stands.
      expect(issue(workspace, 'DS-12')!.assigneeId, later).toBe(
        later === 'reassign' ? 'u-ben' : 'u-dana',
      )
      // Unwinding the later one first frees it, so the chain still undoes in order.
      changes = undoChange(workspace, changes, 'c-2', AT).changes!
      expect(undoChange(workspace, changes, 'c-1', AT).result.ok, later).toBe(true)
      expect(issue(workspace, 'DS-12'), later).toMatchObject({ assigneeId: null, status: 'todo' })
    }
  })

  it('refuses to undo a status change over a reassignment the journal never saw', () => {
    // The MCP server is not the only way in: a field that no longer reads what
    // the write left refuses on its own, recorded or not.
    const { workspace, changes } = statusChange()
    assignIssue(workspace, { issueKey: 'DS-7', assigneeId: 'u-chidi' })

    expect(errorCode(undoChange(workspace, changes, 'c-1', AT).result)).toBe('UNDO_CONFLICT')
    expect(issue(workspace, 'DS-7')).toMatchObject({ status: 'done', assigneeId: 'u-chidi' })
  })

  it('refuses an id it has no record of', () => {
    const { workspace, changes } = statusChange()
    expect(errorCode(undoChange(workspace, changes, 'c-unknown', AT).result)).toBe('UNDO_CONFLICT')
    expect(errorCode(undoChange(workspace, [], 'c-1', AT).result)).toBe('UNDO_CONFLICT')
  })

  it('has nothing to undo for a write it does not record', () => {
    const workspace = createWorkspaceSeed()
    const notes = createReleaseNotes(workspace, { version: 'v9.0.0', markdown: '# v9.0.0' })
    expect(notes.ok && 'changeId' in notes.data).toBe(false)
    const id = notes.ok ? notes.data.releaseNote.id : ''

    expect(errorCode(undoChange(workspace, [], id, AT).result)).toBe('UNDO_CONFLICT')
  })

  it('rejects a malformed or oversized id before looking anything up', () => {
    const { workspace, changes } = statusChange()
    for (const bad of ['', 'x'.repeat(MAX_CHANGE_ID_LENGTH + 1), 'c 1', '../c-1', 42, null]) {
      expect(errorCode(undoChange(workspace, changes, bad, AT).result), String(bad)).toBe(
        'INVALID_INPUT',
      )
    }
    expect(issue(workspace, 'DS-7')!.status).toBe('done')
  })
})
