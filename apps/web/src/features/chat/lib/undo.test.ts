import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { requestUndo, undoneCopy, undoTargetOf } from './undo'

const seed = createWorkspaceSeed()
const DS9 = seed.issues.find((issue) => issue.key === 'DS-9')!
const DS12 = seed.issues.find((issue) => issue.key === 'DS-12')!

/** An approved, applied DS-9 status change; `over` swaps any field. */
function applied(over: Record<string, unknown> = {}) {
  return {
    type: 'tool-update_issue_status',
    state: 'output-available',
    approval: { approved: true },
    output: { ok: true, data: { issue: DS9, previousStatus: 'in_progress', changeId: 'chg-1' } },
    ...over,
  }
}

describe('undoTargetOf', () => {
  it('reads the change id and the issue off an applied write the workspace recorded', () => {
    expect(undoTargetOf(applied())).toEqual({ changeId: 'chg-1', issueKey: 'DS-9' })
    expect(undoTargetOf(applied({ type: 'dynamic-tool', toolName: 'create_issue' }))).toEqual({
      changeId: 'chg-1',
      issueKey: 'DS-9',
    })
    // A reassignment is recorded like a status change, so it is undone like one.
    expect(undoTargetOf(applied({ type: 'tool-assign_issue' }))).toEqual({
      changeId: 'chg-1',
      issueKey: 'DS-9',
    })
  })

  it('offers nothing a server could not undo', () => {
    // Not one of the undoable writes, even if it carried an id.
    expect(undoTargetOf(applied({ type: 'tool-run_deployment' }))).toBeUndefined()
    expect(undoTargetOf(applied({ type: 'tool-create_release_notes' }))).toBeUndefined()
    // Denied, still running, failed, or from an api that records nothing.
    expect(undoTargetOf(applied({ approval: { approved: false } }))).toBeUndefined()
    expect(undoTargetOf(applied({ state: 'approval-responded' }))).toBeUndefined()
    expect(
      undoTargetOf(applied({ output: { ok: false, error: { code: 'ISSUE_NOT_FOUND' } } })),
    ).toBeUndefined()
    expect(undoTargetOf(applied({ output: { ok: true, data: { issue: DS9 } } }))).toBeUndefined()
  })
})

describe('undoneCopy', () => {
  const data = {
    changeId: 'chg-1',
    tool: 'update_issue_status' as const,
    issueKey: 'DS-9',
    outcome: 'restored' as const,
    issue: DS9,
    undoneAt: '2026-10-25T13:05:00.000Z',
  }

  it('says where the issue is back to, in the board’s words', () => {
    expect(undoneCopy(data, '14:05')).toEqual([
      'Undone by you at 14:05 — ',
      { id: 'DS-9' },
      ' back to In progress.',
    ])
  })

  it('says a created issue is off the board', () => {
    expect(
      undoneCopy({
        ...data,
        tool: 'create_issue',
        outcome: 'removed',
        issue: null,
        issueKey: 'DS-14',
      }),
    ).toEqual(['Undone by you — ', { id: 'DS-14' }, ' removed from the board.'])
  })

  it('says who holds a reassigned issue again, by @handle as the board does', () => {
    const assignment = { ...data, tool: 'assign_issue' as const, issueKey: 'DS-12' }
    expect(
      undoneCopy({ ...assignment, issue: { ...DS12, assigneeId: 'u-ben' } }, '14:07', seed.users),
    ).toEqual(['Undone by you at 14:07 — ', { id: 'DS-12' }, ' back to @ben.'])
    // A first assignment undone leaves the issue with nobody, said in words.
    expect(undoneCopy({ ...assignment, issue: DS12 }, '14:07', seed.users)).toEqual([
      'Undone by you at 14:07 — ',
      { id: 'DS-12' },
      ' back to unassigned.',
    ])
  })
})

describe('requestUndo', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('hands back a refusal as its envelope, like a tool’s', async () => {
    const refusal = { ok: false, error: { code: 'UNDO_CONFLICT', message: 'moved on' } }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(refusal), { status: 409 }))),
    )
    await expect(requestUndo('chg-1')).resolves.toEqual(refusal)
  })

  it('throws when the reply is not an envelope, since then nothing is known', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('Bad gateway', { status: 502 }))),
    )
    await expect(requestUndo('chg-1')).rejects.toThrow('undo answered 502')
  })
})
