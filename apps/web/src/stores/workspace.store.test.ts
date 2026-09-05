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
