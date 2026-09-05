import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'

export interface WorkspaceStore {
  /** The live workspace snapshot; Phase 3 callers only read from it. */
  get(): Workspace
  /** Restores the seed — used by tests and, later, the daily reset (Phase 9). */
  reset(): void
}

/**
 * In-memory workspace, one per Worker isolate. State is neither shared
 * between isolates nor kept across restarts; D1 replaces it in Phase 9.
 * Phase 3 only reads, so per-isolate copies of the same seed are
 * indistinguishable to clients.
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

/** Module-level singleton shared by the routes and the tool set. */
export const workspaceStore = createWorkspaceStore()
