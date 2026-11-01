import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { CHANGE_HIGHLIGHT_MS, changedIssueKeys, useWorkspaceStore } from './workspace'

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

  it('hydrate() keeps the last good board when a later read fails', async () => {
    // A return to the tab can read before the network is back. Swapping in the
    // seed then would make an open card for an issue made over MCP say it is
    // not on the board.
    const remote = createWorkspaceSeed()
    remote.project.name = 'DevSprint (from api)'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(remote), { status: 200 }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response(JSON.stringify(remote), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const store = useWorkspaceStore()
    await store.hydrate()
    const readAt = store.readAt
    expect(store.offline).toBe(false)

    await store.hydrate()
    // Still the Worker's board, and still dated by the read that produced it.
    expect(store.source).toBe('api')
    expect(store.offline).toBe(true)
    expect(store.workspace.project.name).toBe('DevSprint (from api)')
    expect(store.readAt).toBe(readAt)

    await store.hydrate()
    expect(store.offline).toBe(false)
  })

  it('says offline while it has never read the Worker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    )
    const store = useWorkspaceStore()
    await store.hydrate()
    expect(store.source).toBe('seed')
    expect(store.offline).toBe(true)
  })

  it('lets only the latest of two overlapping reads land', async () => {
    // A return read still in flight when a turn settles and reads again: if
    // the older answer came back last, it would undo the newer board and mark
    // the moves it undid.
    const older = createWorkspaceSeed()
    const newer = createWorkspaceSeed()
    newer.issues.find((issue) => issue.key === 'DS-7')!.status = 'done'
    const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    let answerOlder: (response: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(respond(createWorkspaceSeed()))
        .mockReturnValueOnce(new Promise<Response>((resolve) => (answerOlder = resolve)))
        .mockResolvedValueOnce(respond(newer)),
    )

    const store = useWorkspaceStore()
    await store.hydrate()
    const first = store.hydrate()
    const second = store.hydrate()
    await second
    expect(store.workspace.issues.find((issue) => issue.key === 'DS-7')?.status).toBe('done')
    expect(store.hydrating).toBe(false)

    answerOlder(respond(older))
    await first
    expect(store.workspace.issues.find((issue) => issue.key === 'DS-7')?.status).toBe('done')
    expect([...store.recentlyChanged]).toEqual(['DS-7'])
  })

  it('stays hydrating until the latest read answers', async () => {
    let answerLatest: (response: Response) => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(createWorkspaceSeed())))
        .mockReturnValueOnce(new Promise<Response>((resolve) => (answerLatest = resolve))),
    )
    const store = useWorkspaceStore()
    const first = store.hydrate()
    const second = store.hydrate()
    await first
    expect(store.hydrating).toBe(true)
    answerLatest(new Response(JSON.stringify(createWorkspaceSeed())))
    await second
    expect(store.hydrating).toBe(false)
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

describe('changesSinceReset', () => {
  const answer = (workspace: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(workspace), { status: 200 }))),
    )

  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is zero on the seed, and on a read of a board nobody has touched', async () => {
    const store = useWorkspaceStore()
    expect(store.changesSinceReset).toBe(0)
    answer(createWorkspaceSeed())
    await store.hydrate()
    expect(store.changesSinceReset).toBe(0)
  })

  it('counts each issue moved, handed on or new once, and comes back to zero', async () => {
    const store = useWorkspaceStore()
    const board = createWorkspaceSeed()
    const issue = (key: string) => board.issues.find((candidate) => candidate.key === key)!
    issue('DS-7').status = 'done'
    issue('DS-7').assigneeId = 'u-dana'
    issue('DS-9').assigneeId = null
    board.issues.push({ ...issue('DS-7'), id: 'issue-new', key: 'DS-99' })
    answer(board)
    await store.hydrate()
    expect(store.changesSinceReset).toBe(3)

    // An undo, or a reset, puts it back.
    answer(createWorkspaceSeed())
    await store.hydrate()
    expect(store.changesSinceReset).toBe(0)
  })
})

describe('changedIssueKeys', () => {
  it('names the issues that moved, were handed on or are new, and no others', () => {
    const before = createWorkspaceSeed()
    const after = createWorkspaceSeed()
    for (const issue of after.issues) {
      if (issue.key === 'DS-9') issue.status = 'in_review'
      if (issue.key === 'DS-10') issue.title = 'Renamed, not moved'
      if (issue.key === 'DS-12') issue.assigneeId = 'u-dana'
    }
    // An MCP host made it, so nothing else on the page says it arrived.
    after.issues.push({ ...after.issues[0]!, id: 'issue-new', key: 'DS-99', status: 'done' })

    expect([...changedIssueKeys(before, after)].sort()).toEqual(['DS-12', 'DS-9', 'DS-99'])
  })

  it('marks a reassignment that takes the issue off whoever held it', () => {
    const before = createWorkspaceSeed()
    const after = createWorkspaceSeed()
    const held = after.issues.find((issue) => issue.assigneeId !== null)!
    held.assigneeId = null

    expect([...changedIssueKeys(before, after)]).toEqual([held.key])
  })

  it('has nothing to mark for an issue the next read no longer holds', () => {
    const before = createWorkspaceSeed()
    const after = createWorkspaceSeed()
    after.issues = after.issues.filter((issue) => issue.key !== 'DS-9')

    expect(changedIssueKeys(before, after).size).toBe(0)
  })
})
