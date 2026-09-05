import {
  createLocalWorkspaceApi,
  createWorkspaceStore,
  type WorkspaceStore,
} from '../src/workspace/store'

/**
 * A `WORKSPACE` binding backed by an in-memory workspace. `workspaceStub` only
 * ever calls `idFromName` then `get`, so handing back the local implementation
 * exercises the real route wiring without a Durable Object.
 */
export function fakeWorkspaceBinding(store: WorkspaceStore = createWorkspaceStore()) {
  const api = createLocalWorkspaceApi(store)
  return {
    store,
    binding: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => api as unknown as DurableObjectStub<never>,
    },
  }
}
