import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { CHANGE_HIGHLIGHT_MS, changedStatusKeys, useWorkspaceStore } from './workspace'

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    // Here, not at the end of a test body, so a failed assertion cannot leave
    // fake timers on for the rest of the file.
    vi.useRealTimers()
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

  it('marks the issues a later read moved, then lets the mark go', async () => {
    vi.useFakeTimers()
    const first = createWorkspaceSeed()
    const second = createWorkspaceSeed()
    const moved = second.issues.find((issue) => issue.key === 'DS-7')
    if (!moved) throw new Error('seed lost DS-7')
    moved.status = 'done'
    const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(respond(first)).mockResolvedValueOnce(respond(second)),
    )

    const store = useWorkspaceStore()
    await store.hydrate()
    // The first read only replaces the seed; nothing was shown as live yet.
    expect(store.recentlyChanged.size).toBe(0)

    await store.hydrate()
    expect([...store.recentlyChanged]).toEqual(['DS-7'])

    vi.advanceTimersByTime(CHANGE_HIGHLIGHT_MS - 1)
    expect(store.recentlyChanged.has('DS-7')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(store.recentlyChanged.size).toBe(0)
  })

  it('keeps a mark on screen through a read that moved nothing', async () => {
    vi.useFakeTimers()
    const first = createWorkspaceSeed()
    const second = createWorkspaceSeed()
    const moved = second.issues.find((issue) => issue.key === 'DS-7')
    if (!moved) throw new Error('seed lost DS-7')
    moved.status = 'done'
    const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(respond(first))
        .mockResolvedValueOnce(respond(second))
        .mockResolvedValueOnce(respond(second))
        .mockResolvedValueOnce(new Response('nope', { status: 503 })),
    )

    const store = useWorkspaceStore()
    await store.hydrate()
    await store.hydrate()
    expect([...store.recentlyChanged]).toEqual(['DS-7'])

    // A turn ending soon after, or a failed read, must not cut the mark short.
    vi.advanceTimersByTime(500)
    await store.hydrate()
    expect(store.recentlyChanged.has('DS-7')).toBe(true)
    await store.hydrate()
    expect(store.recentlyChanged.has('DS-7')).toBe(true)

    // It still goes when its own timer says so, not later.
    vi.advanceTimersByTime(CHANGE_HIGHLIGHT_MS - 500)
    expect(store.recentlyChanged.size).toBe(0)
  })
})

describe('changedStatusKeys', () => {
  it('names only issues present in both reads whose status differs', () => {
    const before = createWorkspaceSeed()
    const after = createWorkspaceSeed()
    for (const issue of after.issues) {
      if (issue.key === 'DS-9') issue.status = 'in_review'
      if (issue.key === 'DS-10') issue.title = 'Renamed, not moved'
    }
    after.issues.push({ ...after.issues[0]!, id: 'issue-new', key: 'DS-99', status: 'done' })

    expect([...changedStatusKeys(before, after)]).toEqual(['DS-9'])
  })
})
