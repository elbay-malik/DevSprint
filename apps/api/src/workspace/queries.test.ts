import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed, WORKSPACE_NOW } from '@devsprint/shared'
import {
  diffReleaseNotes,
  getBurndown,
  getDeploymentHistory,
  getSprintStatus,
  listIssues,
  searchIssues,
} from './queries'
import { createReleaseNotes, finishDeployment, startDeployment } from './mutations'

const workspace = createWorkspaceSeed()

/** Narrows the envelope in tests so `.data` access stays type-safe. */
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

describe('listIssues', () => {
  it('lists a sprint in ascending key order', () => {
    const data = expectOk(listIssues(workspace, { sprintId: 'sprint-12', limit: 50 }))
    expect(data.issues.map((issue) => issue.key)).toEqual([
      'DS-5',
      'DS-6',
      'DS-7',
      'DS-8',
      'DS-9',
      'DS-10',
      'DS-11',
    ])
  })

  it('projects only the documented summary fields', () => {
    const data = expectOk(
      listIssues(workspace, { sprintId: 'sprint-12', status: 'blocked', limit: 50 }),
    )
    expect(data.issues).toEqual([
      {
        key: 'DS-11',
        title: 'Load-test digest fan-out',
        status: 'blocked',
        priority: 'medium',
        points: 3,
        assigneeId: 'u-dana',
        sprintId: 'sprint-12',
        labels: ['notifications', 'perf'],
      },
    ])
  })

  it('filters by status, assignee, type and label', () => {
    expect(
      expectOk(
        listIssues(workspace, { sprintId: 'sprint-12', status: 'done', limit: 50 }),
      ).issues.map((issue) => issue.key),
    ).toEqual(['DS-5', 'DS-6'])
    expect(
      expectOk(listIssues(workspace, { assigneeId: 'u-dana', limit: 50 })).issues.map((i) => i.key),
    ).toEqual(['DS-4', 'DS-11'])
    expect(
      expectOk(listIssues(workspace, { type: 'bug', limit: 50 })).issues.map((i) => i.key),
    ).toEqual(['DS-1', 'DS-2', 'DS-8'])
    expect(
      expectOk(listIssues(workspace, { label: 'billing', limit: 50 })).issues.map((i) => i.key),
    ).toEqual(['DS-7', 'DS-10', 'DS-13'])
  })

  it('applies the limit after ordering', () => {
    const data = expectOk(listIssues(workspace, { sprintId: 'sprint-12', limit: 2 }))
    expect(data.issues.map((issue) => issue.key)).toEqual(['DS-5', 'DS-6'])
  })

  it('reports unknown sprints and users', () => {
    expect(expectError(listIssues(workspace, { sprintId: 'sprint-99', limit: 50 })).code).toBe(
      'SPRINT_NOT_FOUND',
    )
    expect(expectError(listIssues(workspace, { assigneeId: 'u-nobody', limit: 50 })).code).toBe(
      'USER_NOT_FOUND',
    )
  })
})

describe('searchIssues', () => {
  it('ranks the billing export issue first for a fuzzy query (S-E)', () => {
    const data = expectOk(searchIssues(workspace, { query: 'billing export', limit: 10 }))
    expect(data.matches[0]?.key).toBe('DS-7')
    expect(data.matches[0]?.title).toBe('Billing export CSV download')
    expect(data.matches[0]?.status).toBe('in_review')
    expect(data.matches[0]?.score).toBeGreaterThan(data.matches[1]?.score ?? 0)
  })

  it('scores an exact key match 1, in any casing or spelling', () => {
    for (const query of ['DS-7', 'ds-7', 'ds7']) {
      const data = expectOk(searchIssues(workspace, { query, limit: 10 }))
      expect(data.matches).toEqual([
        { key: 'DS-7', title: 'Billing export CSV download', status: 'in_review', score: 1 },
      ])
    }
  })

  it('resolves a key named inside a longer phrase', () => {
    for (const query of ['what is DS-10', 'tell me about ds 10', 'status of DS-10?']) {
      const data = expectOk(searchIssues(workspace, { query, limit: 10 }))
      expect(data.matches.map((match) => match.key)).toEqual(['DS-10'])
      expect(data.matches[0]?.score).toBe(1)
    }
  })

  it('resolves every key a query names', () => {
    const data = expectOk(searchIssues(workspace, { query: 'close DS-7 and DS-10', limit: 10 }))
    expect(data.matches.map((match) => match.key)).toEqual(['DS-7', 'DS-10'])
  })

  it('does not let a stopword rank an unrelated issue', () => {
    // 'is' appears in DS-2's description; before the stopword filter it made
    // DS-2 the only match for a query that plainly names DS-10.
    const data = expectOk(searchIssues(workspace, { query: 'what is DS-10', limit: 10 }))
    expect(data.matches.map((match) => match.key)).not.toContain('DS-2')
    expect(expectOk(searchIssues(workspace, { query: 'what is the', limit: 10 })).matches).toEqual(
      [],
    )
  })

  it('stays honest about a key that names nothing, however it is phrased (S-E)', () => {
    for (const query of ['DS-42', 'what is DS-42', 'mark DS-42 as done']) {
      expect(expectOk(searchIssues(workspace, { query, limit: 10 })).matches).toEqual([])
    }
  })

  it('still recovers by content when the query mixes a bad key with real words (S-E)', () => {
    const data = expectOk(searchIssues(workspace, { query: 'DS-42 billing export', limit: 10 }))
    expect(data.matches[0]?.key).toBe('DS-7')
  })

  it('returns ok with no matches for an unknown key (S-E step 4)', () => {
    const result = searchIssues(workspace, { query: 'DS-42', limit: 10 })
    expect(result.ok).toBe(true)
    expect(expectOk(result).matches).toEqual([])
  })

  it('never errors on a query with no usable tokens', () => {
    expect(expectOk(searchIssues(workspace, { query: '???', limit: 10 })).matches).toEqual([])
  })

  it('honours the limit', () => {
    const data = expectOk(searchIssues(workspace, { query: 'billing', limit: 2 }))
    expect(data.matches).toHaveLength(2)
  })
})

describe('getSprintStatus', () => {
  it('defaults to the active sprint and matches the documented health', () => {
    const data = expectOk(getSprintStatus(workspace, {}))
    expect(data.sprint.id).toBe('sprint-12')
    expect(data.stats).toEqual({
      committedPoints: 31,
      completedPoints: 8,
      remainingPoints: 23,
      daysRemaining: 4,
      issueCountsByStatus: { todo: 0, in_progress: 2, in_review: 2, blocked: 1, done: 2 },
      blockedIssueKeys: ['DS-11'],
    })
  })

  it('never reports negative days for a finished sprint', () => {
    const data = expectOk(getSprintStatus(workspace, { sprintId: 'sprint-11' }))
    expect(data.stats.daysRemaining).toBe(0)
    expect(data.stats.completedPoints).toBe(13)
    expect(data.stats.remainingPoints).toBe(0)
  })

  it('reports an unknown sprint', () => {
    expect(expectError(getSprintStatus(workspace, { sprintId: 'sprint-99' })).code).toBe(
      'SPRINT_NOT_FOUND',
    )
  })
})

describe('getDeploymentHistory', () => {
  it('returns the most recent deployments first', () => {
    const data = expectOk(getDeploymentHistory(workspace, { limit: 5 }))
    expect(data.deployments.map((deployment) => deployment.id)).toEqual([
      'dep-5',
      'dep-4',
      'dep-3',
      'dep-2',
      'dep-1',
    ])
  })

  it('filters by environment and limit (S-C step 2)', () => {
    const data = expectOk(getDeploymentHistory(workspace, { environment: 'staging', limit: 1 }))
    expect(data.deployments).toEqual([
      {
        id: 'dep-4',
        environment: 'staging',
        version: 'v1.4.2',
        status: 'succeeded',
        startedAt: '2026-06-18T09:45:00Z',
        finishedAt: '2026-06-18T09:56:00Z',
        triggeredById: 'u-chidi',
      },
    ])
  })
})

describe('getBurndown', () => {
  it('emits one bucket per calendar day of the active sprint', () => {
    const data = expectOk(getBurndown(workspace, {}))
    expect(data.sprintId).toBe('sprint-12')
    expect(data.unit).toBe('points')
    expect(data.committedPoints).toBe(31)
    expect(data.asOf).toBe(WORKSPACE_NOW)
    expect(data.days).toHaveLength(14)
    expect(data.days[0]?.date).toBe('2026-06-22')
    expect(data.days.at(-1)?.date).toBe('2026-07-05')
  })

  it('burns down as issues complete and stays flat after the demo clock', () => {
    const byDate = new Map(expectOk(getBurndown(workspace, {})).days.map((day) => [day.date, day]))
    expect(byDate.get('2026-06-22')?.remaining).toBe(31)
    expect(byDate.get('2026-06-25')?.remaining).toBe(28)
    expect(byDate.get('2026-06-29')?.remaining).toBe(23)
    expect(byDate.get('2026-07-01')?.remaining).toBe(23)
    expect(byDate.get('2026-07-05')?.remaining).toBe(23)
  })

  it('interpolates the ideal line from committed to zero', () => {
    const days = expectOk(getBurndown(workspace, {})).days
    expect(days[0]?.ideal).toBe(31)
    expect(days.at(-1)?.ideal).toBe(0)
    expect(days[7]?.ideal).toBe(14.31)
  })

  it('leaves the sprint behind the ideal line at the demo clock (S-D)', () => {
    const today = expectOk(getBurndown(workspace, {})).days.find((day) => day.date === '2026-07-01')
    expect(today).toBeDefined()
    expect(today!.remaining).toBeGreaterThan(today!.ideal)
  })

  it('reports an unknown sprint', () => {
    expect(expectError(getBurndown(workspace, { sprintId: 'sprint-99' })).code).toBe(
      'SPRINT_NOT_FOUND',
    )
  })
})

describe('diffReleaseNotes', () => {
  const draft = [
    '## v1.5.0 — Sprint 12: Notifications & billing',
    '',
    '### Added',
    '',
    '- Daily notification digest email template (DS-5)',
    '- Digest scheduling worker (DS-6)',
  ].join('\n')

  it('defaults to the latest published note and classifies section changes', () => {
    const data = expectOk(diffReleaseNotes(workspace, { draftMarkdown: draft }))
    expect(data.baseVersion).toBe('v1.4.2')
    expect(data.after).toBe(draft)
    expect(data.before).toContain('## v1.4.2 — Sprint 11: Search & auth hardening')
    expect(data.changedSections).toEqual([
      { heading: 'v1.4.2 — Sprint 11: Search & auth hardening', changeType: 'removed' },
      { heading: 'Fixed', changeType: 'removed' },
      { heading: 'Added', changeType: 'modified' },
      { heading: 'v1.5.0 — Sprint 12: Notifications & billing', changeType: 'added' },
    ])
  })

  it('compares against the last *published* note, even once a newer draft exists', () => {
    // create_release_notes only ever saves drafts, so after one S-A run the
    // newest note is v1.5.0's own draft. Diffing against that would compare the
    // draft with itself; the baseline is what readers were last shown.
    const withDraft = createWorkspaceSeed()
    expectOk(createReleaseNotes(withDraft, { version: 'v1.5.0', markdown: draft }))
    const data = expectOk(diffReleaseNotes(withDraft, { draftMarkdown: draft }))
    expect(data.baseVersion).toBe('v1.4.2')
    expect(data.changedSections).not.toHaveLength(0)
  })

  it('reads a lone line terminator inside a heading as part of its text', () => {
    for (const terminator of ['\r', '\u2028', '\u2029']) {
      const data = expectOk(
        diffReleaseNotes(workspace, { draftMarkdown: `# a${terminator}b\nbody` }),
      )
      expect(data.changedSections).toContainEqual({
        heading: `a${terminator}b`,
        changeType: 'added',
      })
    }
  })

  it('does not backtrack over a heading line padded with spaces', () => {
    // Five times the schema's cap, so the quadratic version takes seconds and a
    // busy CI machine cannot make the linear one look slow.
    const spaces = ' '.repeat(100_000)
    for (const tail of ['\rx\ry', '\u2028x\u2028y']) {
      const started = performance.now()
      expectOk(diffReleaseNotes(workspace, { draftMarkdown: `# ${spaces}${tail}` }))
      expect(performance.now() - started).toBeLessThan(1_000)
    }
  })

  it('does not mistake a comment inside a code fence for a heading', () => {
    const withFence = [
      '## v1.5.0 — Sprint 12: Notifications & billing',
      '',
      '### Added',
      '',
      '- Billing export CSV download (DS-7)',
      '',
      '```sh',
      '# run the migration before deploying',
      'npm run migrate',
      '```',
      '',
      '- Digest scheduling worker (DS-6)',
    ].join('\n')
    const data = expectOk(diffReleaseNotes(workspace, { draftMarkdown: withFence }))
    const headings = data.changedSections.map((section) => section.heading)
    expect(headings).not.toContain('run the migration before deploying')
    // The fence must not truncate the section either — the bullet after it still counts.
    expect(data.changedSections).toContainEqual({ heading: 'Added', changeType: 'modified' })
  })

  it('reports no changes when the draft equals the base', () => {
    const base = workspace.releaseNotes[0]!
    const data = expectOk(
      diffReleaseNotes(workspace, { draftMarkdown: base.markdown, baseVersion: 'v1.4.2' }),
    )
    expect(data.changedSections).toEqual([])
  })

  it('does not persist anything', () => {
    const before = workspace.releaseNotes.length
    diffReleaseNotes(workspace, { draftMarkdown: draft })
    expect(workspace.releaseNotes).toHaveLength(before)
  })

  it('rejects an unknown base version', () => {
    const error = expectError(
      diffReleaseNotes(workspace, { draftMarkdown: draft, baseVersion: 'v9.9.9' }),
    )
    expect(error.code).toBe('INVALID_INPUT')
    expect(error.message).toContain('v9.9.9')
  })
})

describe('query fixes found by the Phase 0-9 audit', () => {
  it('returns the newest agent-created deployment first, despite the frozen clock', () => {
    // Every agent-created run stamps the same `workspace.now`, so a plain
    // date sort is a tie and a stable sort hands them back oldest-first —
    // the opposite of what the docstring promises. S-C's pre-check asks for
    // `limit: 1`, so this is on the demo path, not a corner.
    const workspace = createWorkspaceSeed()
    startDeployment(workspace, { environment: 'staging', version: 'v9.0.0', skipTests: false })
    finishDeployment(workspace, {
      deploymentId: workspace.deployments.at(-1)!.id,
      status: 'cancelled',
    })
    startDeployment(workspace, { environment: 'staging', version: 'v9.0.1', skipTests: false })

    const latest = expectOk(
      getDeploymentHistory(workspace, { environment: 'staging', limit: 1 }),
    ).deployments

    expect(latest).toHaveLength(1)
    expect(latest[0]?.version).toBe('v9.0.1')
  })

  it('matches a label whatever its casing', () => {
    // Labels are free-form and `create_issue` can mint any casing, so an exact
    // match answers a near-miss with a confident empty list.
    const workspace = createWorkspaceSeed()
    const exact = expectOk(listIssues(workspace, { label: 'billing', limit: 50 })).issues
    expect(exact.length).toBeGreaterThan(0)

    const shouted = expectOk(listIssues(workspace, { label: 'BILLING', limit: 50 })).issues
    expect(shouted.map((issue) => issue.key)).toEqual(exact.map((issue) => issue.key))
  })

  it('honours limit when the query names keys directly', () => {
    const workspace = createWorkspaceSeed()
    const matches = expectOk(
      searchIssues(workspace, { query: 'look at DS-7 and DS-8 and DS-9', limit: 2 }),
    ).matches

    expect(matches).toHaveLength(2)
  })
})
