import type { WorkspaceApi } from '@devsprint/shared/tools'
import {
  createLocalWorkspaceApi,
  createWorkspaceStore,
  type WorkspaceStore,
} from '../src/workspace/store'

/**
 * A `WORKSPACE` binding backed by an in-memory workspace. `workspaceStub` only
 * ever calls `idFromName` then `get`, so handing back the local implementation
 * exercises the real route wiring without a Durable Object. `overrides`
 * replaces single methods, for a test that needs the workspace to answer one
 * call differently from what its store holds.
 */
export function fakeWorkspaceBinding(
  store: WorkspaceStore = createWorkspaceStore(),
  overrides: Partial<WorkspaceApi> = {},
) {
  const api = { ...createLocalWorkspaceApi(store), ...overrides }
  return {
    store,
    binding: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => api as unknown as DurableObjectStub<never>,
    },
  }
}
