import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import type { DailyModelUsage, WorkspaceApi } from '@devsprint/shared/tools'
import {
  diffReleaseNotes,
  getBurndown,
  getDeploymentHistory,
  getSprintStatus,
  listIssues,
  searchIssues,
} from './queries'
import {
  createIssue,
  createReleaseNotes,
  finishDeployment,
  setDeploymentStage,
  startDeployment,
  updateIssueStatus,
} from './mutations'

export interface WorkspaceStore {
  /** The live workspace snapshot. */
  get(): Workspace
  /** Restores the seed — the board and the approval ledger both. */
  reset(): void
  /** Approval ids already spent, mirroring the DO's persisted ledger (ADR-0014). */
  spentApprovals(): Set<string>
  /** Model tokens spent today, mirroring the DO's daily budget (ADR-0016). */
  modelUsage(): DailyModelUsage
  recordModelUsage(tokens: number): DailyModelUsage
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
  let usage: DailyModelUsage | undefined

  /** Rolls over on the real UTC date, the same way the DO's copy does. */
  const currentUsage = (): DailyModelUsage => {
    const day = new Date(Date.now()).toISOString().slice(0, 10)
    if (!usage || usage.day !== day) usage = { day, tokens: 0 }
    return usage
  }
  let ledger = new Set<string>()
  return {
    get: () => workspace,
    reset: () => {
      workspace = createWorkspaceSeed()
      ledger = new Set()
    },
    spentApprovals: () => ledger,
    modelUsage: () => currentUsage(),
    recordModelUsage: (tokens) => {
      const current = currentUsage()
      const spent = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0
      usage = { day: current.day, tokens: current.tokens + spent }
      return usage
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
    startDeployment: (input) => Promise.resolve(startDeployment(store.get(), input)),
    setDeploymentStage: (input) => Promise.resolve(setDeploymentStage(store.get(), input)),
    finishDeployment: (input) => Promise.resolve(finishDeployment(store.get(), input)),
    // The in-memory twin of the DO's daily budget: same contract, no storage,
    // so a test can drive the cap without a Durable Object.
    modelUsage: () => Promise.resolve(store.modelUsage()),
    recordModelUsage: (tokens) => Promise.resolve(store.recordModelUsage(tokens)),
    // One at a time rather than filter-then-bulk-add, so an in-call duplicate
    // is caught too — mirrors the DO's real implementation. No eviction cap
    // here: that guards a Durable Object storage limit this in-memory Set does
    // not have.
    spendApprovals: (ids) => {
      const ledger = store.spentApprovals()
      const alreadySpent: string[] = []
      for (const id of ids) {
        if (ledger.has(id)) {
          alreadySpent.push(id)
        } else {
          ledger.add(id)
        }
      }
      return Promise.resolve(alreadySpent)
    },
  }
}

/** Module-level singleton used by the test suite. */
export const workspaceStore = createWorkspaceStore()
