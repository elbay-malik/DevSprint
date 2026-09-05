import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import type { WorkspaceApi } from '@devsprint/shared/tools'
import {
  diffReleaseNotes,
  getBurndown,
  getDeploymentHistory,
  getSprintStatus,
  listIssues,
  searchIssues,
} from './queries'
import { createIssue, createReleaseNotes, updateIssueStatus } from './mutations'

export interface WorkspaceStore {
  /** The live workspace snapshot. */
  get(): Workspace
  /** Restores the seed. */
  reset(): void
}

/**
 * In-memory workspace, one per isolate.
 *
 * The deployed app keeps its workspace in a Durable Object so two Workers can
 * share one board (see durable-object.ts). This is the same thing without the
 * durability or the serialisation: it backs the tests, which want the pure
 * functions and none of the runtime.
 */
export function createWorkspaceStore(): WorkspaceStore {
  let workspace = createWorkspaceSeed()
  return {
    get: () => workspace,
    reset: () => {
      workspace = createWorkspaceSeed()
    },
  }
}

/**
 * The workspace interface over a plain in-memory store, so a test can drive the
 * tool layer without a Durable Object. Mirrors WorkspaceDO method for method —
 * both delegate to the same query and mutation functions.
 */
export function createLocalWorkspaceApi(store: WorkspaceStore): WorkspaceApi {
  return {
    snapshot: () => Promise.resolve(store.get()),
    reset: () => {
      store.reset()
      return Promise.resolve(store.get())
    },
    listIssues: (input) => Promise.resolve(listIssues(store.get(), input)),
    searchIssues: (input) => Promise.resolve(searchIssues(store.get(), input)),
    getSprintStatus: (input) => Promise.resolve(getSprintStatus(store.get(), input)),
    getDeploymentHistory: (input) => Promise.resolve(getDeploymentHistory(store.get(), input)),
    getBurndown: (input) => Promise.resolve(getBurndown(store.get(), input)),
    diffReleaseNotes: (input) => Promise.resolve(diffReleaseNotes(store.get(), input)),
    createIssue: (input) => Promise.resolve(createIssue(store.get(), input)),
    updateIssueStatus: (input) => Promise.resolve(updateIssueStatus(store.get(), input)),
    createReleaseNotes: (input) => Promise.resolve(createReleaseNotes(store.get(), input)),
  }
}

/** Module-level singleton used by the test suite. */
export const workspaceStore = createWorkspaceStore()
