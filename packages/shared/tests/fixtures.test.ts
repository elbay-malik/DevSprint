import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed, WORKSPACE_NOW } from '../src/index'

/**
 * Load-bearing invariants from docs/domain-model.md: demo scenario S-B needs
 * exactly 5 open Sprint-12 issues, and S-E needs DS-7 to exist and DS-42 not to.
 */
describe('workspace seed', () => {
  const workspace = createWorkspaceSeed()
  const sprint12Issues = workspace.issues.filter((i) => i.sprintId === 'sprint-12')

  it('uses the fixed demo clock', () => {
    expect(WORKSPACE_NOW).toBe('2026-07-01T09:00:00Z')
    expect(workspace.now).toBe(WORKSPACE_NOW)
  })

  it('has 13 issues, 2 sprints, 4 users, 5 deployments, 1 release note', () => {
    expect(workspace.issues).toHaveLength(13)
    expect(workspace.sprints).toHaveLength(2)
    expect(workspace.users).toHaveLength(4)
    expect(workspace.deployments).toHaveLength(5)
    expect(workspace.releaseNotes).toHaveLength(1)
  })

  it('sprint-12 committed 31 points with 8 done', () => {
    const committed = sprint12Issues.reduce((sum, i) => sum + i.points, 0)
    const done = sprint12Issues
      .filter((i) => i.status === 'done')
      .reduce((sum, i) => sum + i.points, 0)
    expect(committed).toBe(31)
    expect(done).toBe(8)
  })

  it('sprint-12 has exactly 5 open issues (scenario S-B approval gates)', () => {
    const open = sprint12Issues.filter((i) => i.status !== 'done')
    expect(open.map((i) => i.key).sort()).toEqual(['DS-10', 'DS-11', 'DS-7', 'DS-8', 'DS-9'])
  })

  it('DS-7 is the billing export issue and DS-42 does not exist (scenario S-E)', () => {
    const ds7 = workspace.issues.find((i) => i.key === 'DS-7')
    expect(ds7?.title).toBe('Billing export CSV download')
    expect(workspace.issues.some((i) => i.key === 'DS-42')).toBe(false)
  })

  it('returns a fresh copy on every call', () => {
    const a = createWorkspaceSeed()
    const b = createWorkspaceSeed()
    expect(a).not.toBe(b)
    expect(a.issues[0]).not.toBe(b.issues[0])
  })
})
