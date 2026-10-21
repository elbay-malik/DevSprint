import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { useWorkspaceStore } from './workspace'

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts from the seed', () => {
    const store = useWorkspaceStore()
    expect(store.source).toBe('seed')
    expect(store.hydrating).toBe(false)
    expect(store.workspace).toEqual(createWorkspaceSeed())
  })

  it('holds the active sprint only — never a closed sprint or the backlog', () => {
    // Sprint 11 is closed but its issues are still in the workspace; the board
    // and the stats above it are the active sprint's, and only its.
    const store = useWorkspaceStore()
    expect(store.sprintIssues.map((issue) => issue.key).sort()).toEqual(
      ['DS-10', 'DS-11', 'DS-5', 'DS-6', 'DS-7', 'DS-8', 'DS-9'].sort(),
    )
    expect(store.stats).toMatchObject({ committedPoints: 31, completedPoints: 8 })
  })

  it('recomputes the sprint stats when a hydrate brings in a moved issue', async () => {
    // The header counts have to follow the board after an approved write (S-B),
    // not stay frozen at whatever the store was created with.
    const remote = createWorkspaceSeed()
    const moved = remote.issues.find((issue) => issue.key === 'DS-7')
    if (!moved) throw new Error('seed lost DS-7')
    moved.status = 'done'
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(remote), { status: 200 }))),
    )

    const store = useWorkspaceStore()
    const before = store.stats.completedPoints
    await store.hydrate()

    expect(store.stats.completedPoints).toBe(before + moved.points)
    expect(store.stats.remainingPoints).toBe(31 - before - moved.points)
  })

  it('hydrate() replaces the seed with the api workspace', async () => {
    const remote = createWorkspaceSeed()
    remote.project.name = 'DevSprint (from api)'
    remote.issues = remote.issues.filter((issue) => issue.key !== 'DS-13')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(remote), { status: 200 }))),
    )

    const store = useWorkspaceStore()
    await store.hydrate()

    expect(store.source).toBe('api')
    expect(store.hydrating).toBe(false)
    expect(store.workspace.project.name).toBe('DevSprint (from api)')
    expect(store.workspace.issues).toHaveLength(12)
    expect(store.backlogIssues.map((issue) => issue.key)).toEqual(['DS-12'])
  })

  it('hydrate() keeps the seed and warns once when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    )

    const store = useWorkspaceStore()
    await store.hydrate()
    await store.hydrate()

    expect(store.source).toBe('seed')
    expect(store.hydrating).toBe(false)
    expect(store.workspace).toEqual(createWorkspaceSeed())
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('hydrate() falls back to the seed when a later refresh fails', async () => {
    // The pane hydrates on every mount, so this is one route change away.
    const remote = createWorkspaceSeed()
    remote.project.name = 'DevSprint (from api)'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(remote), { status: 200 }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)

    const store = useWorkspaceStore()
    await store.hydrate()
    expect(store.source).toBe('api')

    await store.hydrate()

    // The badge must never claim 'seed' while the board still shows api data.
    expect(store.source).toBe('seed')
    expect(store.workspace).toEqual(createWorkspaceSeed())
    expect(store.workspace.project.name).toBe('DevSprint')
  })

  it('hydrate() treats a non-2xx response as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
    )

    const store = useWorkspaceStore()
    await store.hydrate()

    expect(store.source).toBe('seed')
    expect(store.workspace).toEqual(createWorkspaceSeed())
    expect(console.warn).toHaveBeenCalledTimes(1)
  })
})
