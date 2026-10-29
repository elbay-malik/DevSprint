import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed, WORKSPACE_NOW, type Workspace } from '@devsprint/shared'
import {
  assignIssue,
  createIssue,
  MAX_CREATED_ISSUES,
  createReleaseNotes,
  finishDeployment,
  setDeploymentStage,
  startDeployment,
  updateIssueStatus,
} from './mutations'
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

  it('keeps every field the caller chose', () => {
    // The key is ours to assign; the rest is the host's write (S-F) and must
    // land as asked, not with a default quietly substituted.
    const { issue } = expectOk(
      createIssue(seed(), {
        title: 'Rate-limit exports',
        type: 'bug',
        priority: 'urgent',
        sprintId: null,
      }),
    )
    expect(issue).toMatchObject({ title: 'Rate-limit exports', type: 'bug', priority: 'urgent' })
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

describe('createIssue — the day cap', () => {
  it('refuses a new issue once the day has added MAX_CREATED_ISSUES', () => {
    const workspace = seed()
    const input = {
      title: 'filler',
      type: 'chore' as const,
      priority: 'medium' as const,
      sprintId: null,
    }
    for (let i = 0; i < MAX_CREATED_ISSUES; i += 1) expectOk(createIssue(workspace, input))

    const refused = createIssue(workspace, input)

    expect(refused).toMatchObject({ ok: false, error: { code: 'WORKSPACE_FULL' } })
    expect(workspace.issues).toHaveLength(13 + MAX_CREATED_ISSUES)
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

describe('assignIssue', () => {
  it('hands an unassigned issue to a teammate and reports who held it', () => {
    const workspace = seed()

    const data = expectOk(assignIssue(workspace, { issueKey: 'DS-12', assigneeId: 'u-dana' }))

    expect(data.previousAssigneeId).toBeNull()
    expect(data.issue).toMatchObject({
      key: 'DS-12',
      assigneeId: 'u-dana',
      updatedAt: WORKSPACE_NOW,
    })
    expect(workspace.issues.find((issue) => issue.key === 'DS-12')?.assigneeId).toBe('u-dana')
  })

  it('reassigns, touching nothing but the assignee', () => {
    const workspace = seed()
    const before = structuredClone(workspace.issues.find((issue) => issue.key === 'DS-7')!)

    const data = expectOk(assignIssue(workspace, { issueKey: 'ds-7', assigneeId: 'u-chidi' }))

    expect(data.previousAssigneeId).toBe('u-ben')
    expect(data.issue).toEqual({ ...before, assigneeId: 'u-chidi', updatedAt: WORKSPACE_NOW })
  })

  it('unassigns with null', () => {
    const workspace = seed()

    const data = expectOk(assignIssue(workspace, { issueKey: 'DS-11', assigneeId: null }))

    expect(data.previousAssigneeId).toBe('u-dana')
    expect(workspace.issues.find((issue) => issue.key === 'DS-11')?.assigneeId).toBeNull()
  })

  it('reports an unknown key and points at the recovery path', () => {
    const workspace = seed()
    const error = expectError(assignIssue(workspace, { issueKey: 'DS-42', assigneeId: 'u-dana' }))
    expect(error.code).toBe('ISSUE_NOT_FOUND')
    expect(error.message).toContain('search_issues')
    expect(workspace).toEqual(seed())
  })

  it('refuses an assignee who is not on the roster, rather than writing the id', () => {
    const workspace = seed()

    const error = expectError(assignIssue(workspace, { issueKey: 'DS-12', assigneeId: 'u-zoe' }))

    expect(error.code).toBe('USER_NOT_FOUND')
    // The model is told who it could have meant.
    expect(error.message).toContain('u-dana')
    expect(workspace.issues.find((issue) => issue.key === 'DS-12')?.assigneeId).toBeNull()
  })

  it('refuses a no-op, to someone or to nobody, without touching the issue', () => {
    const workspace = seed()

    const same = expectError(assignIssue(workspace, { issueKey: 'DS-11', assigneeId: 'u-dana' }))
    const nobody = expectError(assignIssue(workspace, { issueKey: 'DS-12', assigneeId: null }))

    expect(same).toEqual({ code: 'INVALID_INPUT', message: 'DS-11 is already assigned to u-dana.' })
    expect(nobody).toEqual({ code: 'INVALID_INPUT', message: 'DS-12 is already unassigned.' })
    expect(workspace).toEqual(seed())
  })

  it('returns a snapshot, so a later write cannot rewrite an earlier result', () => {
    const workspace = seed()
    const first = expectOk(assignIssue(workspace, { issueKey: 'DS-12', assigneeId: 'u-dana' }))
    assignIssue(workspace, { issueKey: 'DS-12', assigneeId: 'u-ben' })
    expect(first.issue.assigneeId).toBe('u-dana')
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

describe('setDeploymentStage', () => {
  function running(workspace: Workspace) {
    return expectOk(
      startDeployment(workspace, {
        environment: 'staging',
        version: 'v9.9.9',
        skipTests: false,
      }),
    ).deployment
  }

  it('stamps a stage start once, not on every log line', () => {
    const workspace = seed()
    const { id } = running(workspace)

    setDeploymentStage(workspace, { deploymentId: id, stage: 'build', status: 'running' })
    // The demo clock is frozen, so a test written against it would pass either
    // way. Moving it is what makes the assertion mean anything: every log line
    // arrives as another `running` write, and each one used to reset the start.
    workspace.now = '2026-07-01T09:00:30Z'
    setDeploymentStage(workspace, {
      deploymentId: id,
      stage: 'build',
      status: 'running',
      logLine: 'checked out abc1234',
    })
    workspace.now = '2026-07-01T09:01:00Z'
    const result = expectOk(
      setDeploymentStage(workspace, { deploymentId: id, stage: 'build', status: 'succeeded' }),
    )

    const build = result.deployment.stages.find((stage) => stage.name === 'build')
    expect(build?.startedAt).toBe(WORKSPACE_NOW)
    expect(build?.finishedAt).toBe('2026-07-01T09:01:00Z')
  })

  it('leaves a settled deployment alone', () => {
    const workspace = seed()
    const { id } = running(workspace)
    setDeploymentStage(workspace, { deploymentId: id, stage: 'build', status: 'running' })
    finishDeployment(workspace, { deploymentId: id, status: 'cancelled' })

    // The run's next write races the cancel. Reopening the stage here would
    // leave a cancelled deployment with a stage still reading `running`.
    const result = expectOk(
      setDeploymentStage(workspace, { deploymentId: id, stage: 'test', status: 'running' }),
    )

    expect(result.deployment.status).toBe('cancelled')
    expect(result.deployment.stages.every((stage) => stage.status !== 'running')).toBe(true)
  })
})

describe('finishDeployment', () => {
  it('refuses to settle a run twice', () => {
    const workspace = seed()
    // dep-5 in the seed shipped v1.4.2 to production.
    const error = expectError(
      finishDeployment(workspace, { deploymentId: 'dep-5', status: 'cancelled' }),
    )

    expect(error.code).toBe('DEPLOY_ALREADY_SETTLED')
    expect(workspace.deployments.find((d) => d.id === 'dep-5')?.status).toBe('succeeded')
  })
})
