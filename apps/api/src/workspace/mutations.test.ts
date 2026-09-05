import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed, WORKSPACE_NOW, type Workspace } from '@devsprint/shared'
import { createIssue, createReleaseNotes, updateIssueStatus } from './mutations'
import { getBurndown, getSprintStatus } from './queries'

function expectOk<T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`)
  return result.data
}

function expectError(
  result: { ok: true } | { ok: false; error: { code: string; message: string } },
): { code: string; message: string } {
  if (result.ok) throw new Error('expected an error envelope')
  return result.error
}

/** Each test gets its own workspace — these functions mutate what they are given. */
function seed(): Workspace {
  return createWorkspaceSeed()
}

describe('createIssue', () => {
  it('assigns the next key past the highest existing one (S-F)', () => {
    const workspace = seed()
    const { issue } = expectOk(
      createIssue(workspace, {
        title: 'Add CSV export progress indicator',
        type: 'feature',
        priority: 'medium',
        sprintId: null,
      }),
    )

    expect(issue.key).toBe('DS-14')
    expect(issue.id).toBe('ds-14')
    expect(issue.sprintId).toBeNull()
    expect(issue.status).toBe('todo')
    expect(workspace.issues).toHaveLength(14)
  })

  it('stamps the fixed demo clock rather than real time', () => {
    const { issue } = expectOk(
      createIssue(seed(), { title: 'Anything', type: 'chore', priority: 'low', sprintId: null }),
    )
    expect(issue.createdAt).toBe(WORKSPACE_NOW)
    expect(issue.updatedAt).toBe(WORKSPACE_NOW)
    expect(issue.completedAt).toBeNull()
  })

  it('attributes the issue to the agent', () => {
    const { issue } = expectOk(
      createIssue(seed(), { title: 'Anything', type: 'bug', priority: 'high', sprintId: null }),
    )
    expect(issue.reporterId).toBe('agent')
  })

  it('does not inflate a sprint commitment with unestimated work', () => {
    const workspace = seed()
    const before = expectOk(getSprintStatus(workspace, {})).stats.committedPoints
    expectOk(
      createIssue(workspace, {
        title: 'Unestimated',
        type: 'chore',
        priority: 'low',
        sprintId: 'sprint-12',
      }),
    )
    expect(expectOk(getSprintStatus(workspace, {})).stats.committedPoints).toBe(before)
  })

  it('rejects an unknown sprint or assignee without mutating anything', () => {
    const workspace = seed()
    expect(
      expectError(
        createIssue(workspace, {
          title: 'x',
          type: 'bug',
          priority: 'low',
          sprintId: 'sprint-99',
        }),
      ).code,
    ).toBe('SPRINT_NOT_FOUND')
    expect(
      expectError(
        createIssue(workspace, {
          title: 'x',
          type: 'bug',
          priority: 'low',
          sprintId: null,
          assigneeId: 'u-nobody',
        }),
      ).code,
    ).toBe('USER_NOT_FOUND')
    expect(workspace.issues).toHaveLength(13)
  })
})

describe('updateIssueStatus', () => {
  it('moves an issue and reports where it came from (S-B)', () => {
    const workspace = seed()
    const { issue, previousStatus } = expectOk(
      updateIssueStatus(workspace, { issueKey: 'DS-7', status: 'done' }),
    )

    expect(previousStatus).toBe('in_review')
    expect(issue.status).toBe('done')
    expect(issue.completedAt).toBe(WORKSPACE_NOW)
    expect(issue.updatedAt).toBe(WORKSPACE_NOW)
  })

  it('feeds straight through to sprint health', () => {
    const workspace = seed()
    expect(expectOk(getSprintStatus(workspace, {})).stats.completedPoints).toBe(8)
    expectOk(updateIssueStatus(workspace, { issueKey: 'DS-7', status: 'done' }))
    // DS-7 is 5 points.
    expect(expectOk(getSprintStatus(workspace, {})).stats.completedPoints).toBe(13)
    expect(expectOk(getBurndown(workspace, {})).days.at(-1)?.remaining).toBe(18)
  })

  it('un-completes an issue that is reopened', () => {
    const workspace = seed()
    expectOk(updateIssueStatus(workspace, { issueKey: 'DS-5', status: 'in_progress' }))
    const issue = workspace.issues.find((candidate) => candidate.key === 'DS-5')
    expect(issue?.completedAt).toBeNull()
    expect(expectOk(getSprintStatus(workspace, {})).stats.completedPoints).toBe(5)
  })

  it('keeps the blocked reason in step with the status', () => {
    const workspace = seed()
    expectOk(
      updateIssueStatus(workspace, {
        issueKey: 'DS-9',
        status: 'blocked',
        comment: 'Waiting on design',
      }),
    )
    expect(workspace.issues.find((i) => i.key === 'DS-9')?.blockedReason).toBe('Waiting on design')

    // DS-11 is blocked in the seed; unblocking must clear its stale reason.
    expectOk(updateIssueStatus(workspace, { issueKey: 'DS-11', status: 'in_progress' }))
    expect(workspace.issues.find((i) => i.key === 'DS-11')?.blockedReason).toBeNull()
  })

  it('returns a snapshot, so a later write cannot rewrite an earlier result', () => {
    const workspace = seed()
    const first = expectOk(updateIssueStatus(workspace, { issueKey: 'DS-7', status: 'done' }))
    expectOk(updateIssueStatus(workspace, { issueKey: 'DS-7', status: 'in_progress' }))
    expect(first.issue.status).toBe('done')
  })

  it('accepts a key in any casing', () => {
    expect(updateIssueStatus(seed(), { issueKey: 'ds-7', status: 'done' }).ok).toBe(true)
  })

  it('reports an unknown key and points at the recovery path (S-E)', () => {
    const workspace = seed()
    const error = expectError(updateIssueStatus(workspace, { issueKey: 'DS-42', status: 'done' }))
    expect(error.code).toBe('ISSUE_NOT_FOUND')
    expect(error.message).toContain('search_issues')
    expect(workspace.issues).toHaveLength(13)
  })

  it('rejects a no-op move', () => {
    expect(expectError(updateIssueStatus(seed(), { issueKey: 'DS-5', status: 'done' })).code).toBe(
      'INVALID_INPUT',
    )
  })
})

describe('createReleaseNotes', () => {
  it('saves a draft, never a published note (S-A)', () => {
    const workspace = seed()
    const { releaseNote } = expectOk(
      createReleaseNotes(workspace, { version: 'v1.5.0', markdown: '## v1.5.0\n\n- DS-5\n- DS-6' }),
    )

    expect(releaseNote.version).toBe('v1.5.0')
    expect(releaseNote.status).toBe('draft')
    expect(releaseNote.authorId).toBe('agent')
    expect(releaseNote.createdAt).toBe(WORKSPACE_NOW)
    expect(workspace.releaseNotes).toHaveLength(2)
  })

  it('refuses to overwrite an existing version', () => {
    const workspace = seed()
    const error = expectError(
      createReleaseNotes(workspace, { version: 'v1.4.2', markdown: 'anything' }),
    )
    expect(error.code).toBe('VERSION_EXISTS')
    expect(workspace.releaseNotes).toHaveLength(1)
  })

  it('rejects an unknown sprint with a documented error code', () => {
    expect(
      expectError(
        createReleaseNotes(seed(), {
          version: 'v9.9.9',
          markdown: 'x',
          sprintId: 'sprint-99',
        }),
      ).code,
    ).toBe('INVALID_INPUT')
  })
})
