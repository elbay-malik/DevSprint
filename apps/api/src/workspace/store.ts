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
  createReleaseNotes,
  finishDeployment,
  setDeploymentStage,
  startDeployment,
} from './mutations'
import { addClientTokens, type ClientUsage } from './client-usage'
import {
  assignIssueTracked,
  createIssueTracked,
  undoChange,
  updateIssueStatusTracked,
  type BoardChange,
  type Tracked,
} from './changes'

export interface WorkspaceStore {
  /** The live workspace snapshot. */
  get(): Workspace
  /** Restores the seed — the board and the approval ledger both. */
  reset(): void
  /** Approval ids already spent, mirroring the DO's persisted ledger (ADR-0014). */
  spentApprovals(): Set<string>
  /** What each recorded board write changed, mirroring the DO's undo journal. */
  changes(): readonly BoardChange[]
  setChanges(changes: BoardChange[]): void
  /** Running deployments' cancel tokens, mirroring the DO's. */
  cancelTokens(): Map<string, string>
  /** When the board was last reset, real wall-clock ms; 0 before the first. */
  lastResetAt(): number
  /** Model tokens spent today, mirroring the DO's daily budget (ADR-0016). */
  modelUsage(clientKey?: string): DailyModelUsage
  recordModelUsage(tokens: number, clientKey?: string): DailyModelUsage
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
  // Raw keys, unlike the DO's: nothing here is stored, and a test can name a client.
  let clients: ClientUsage | undefined

  /** Rolls over on the real UTC date, the same way the DO's copy does. */
  const currentUsage = (): DailyModelUsage => {
    const day = new Date(Date.now()).toISOString().slice(0, 10)
    if (!usage || usage.day !== day) usage = { day, tokens: 0 }
    return usage
  }
  const currentClients = (day: string): ClientUsage => {
    if (!clients || clients.day !== day) clients = { day, tokens: {} }
    return clients
  }
  let ledger = new Set<string>()
  let changes: BoardChange[] = []
  let cancelTokens = new Map<string, string>()
  let lastResetAt = 0
  return {
    get: () => workspace,
    reset: () => {
      workspace = createWorkspaceSeed()
      ledger = new Set()
      changes = []
      cancelTokens = new Map()
      lastResetAt = Date.now()
    },
    cancelTokens: () => cancelTokens,
    lastResetAt: () => lastResetAt,
    spentApprovals: () => ledger,
    changes: () => changes,
    setChanges: (next) => {
      changes = next
    },
    modelUsage: (clientKey) => {
      const current = currentUsage()
      if (clientKey === undefined) return current
      return { ...current, clientTokens: currentClients(current.day).tokens[clientKey] ?? 0 }
    },
    recordModelUsage: (tokens, clientKey) => {
      const current = currentUsage()
      const spent = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0
      usage = { day: current.day, tokens: current.tokens + spent }
      if (clientKey === undefined) return usage
      const held = addClientTokens(currentClients(current.day).tokens, clientKey, spent)
      clients = { day: current.day, tokens: held }
      return { ...usage, clientTokens: held[clientKey] ?? 0 }
    },
  }
}

/**
 * The workspace interface over a plain in-memory store, so a test can drive the
 * tool layer without a Durable Object. Mirrors WorkspaceDO method for method —
 * both delegate to the same query and mutation functions.
 */
export function createLocalWorkspaceApi(store: WorkspaceStore): WorkspaceApi {
  /** Adopts the journal a write hands back, as the DO's `commit` does. */
  const tracked = <T>({ result, changes }: Tracked<T>) => {
    if (changes !== undefined) store.setChanges(changes)
    return Promise.resolve(result)
  }
  const stamp = () => ({
    changes: store.changes(),
    changeId: crypto.randomUUID(),
    at: new Date(Date.now()).toISOString(),
  })
  return {
    snapshot: () => Promise.resolve(store.get()),
    reset: () => {
      store.reset()
      return Promise.resolve(store.get())
    },
    requestReset: ({ cooldownMs }) => {
      const wait = store.lastResetAt() + cooldownMs - Date.now()
      if (cooldownMs > 0 && wait > 0) {
        return Promise.resolve({
          ok: false as const,
          error: {
            code: 'RESET_COOLDOWN' as const,
            message: `The board was reset moments ago. Try again in ${Math.ceil(wait / 1000)} seconds.`,
          },
        })
      }
      store.reset()
      return Promise.resolve({ ok: true as const, data: store.get() })
    },
    listIssues: (input) => Promise.resolve(listIssues(store.get(), input)),
    searchIssues: (input) => Promise.resolve(searchIssues(store.get(), input)),
    getSprintStatus: (input) => Promise.resolve(getSprintStatus(store.get(), input)),
    getDeploymentHistory: (input) => Promise.resolve(getDeploymentHistory(store.get(), input)),
    getBurndown: (input) => Promise.resolve(getBurndown(store.get(), input)),
    diffReleaseNotes: (input) => Promise.resolve(diffReleaseNotes(store.get(), input)),
    createIssue: (input) => tracked(createIssueTracked(store.get(), input, stamp())),
    updateIssueStatus: (input) => tracked(updateIssueStatusTracked(store.get(), input, stamp())),
    assignIssue: (input) => tracked(assignIssueTracked(store.get(), input, stamp())),
    undoChange: (input) => {
      const { changes, at } = stamp()
      return tracked(undoChange(store.get(), changes, input.changeId, at))
    },
    createReleaseNotes: (input) => Promise.resolve(createReleaseNotes(store.get(), input)),
    startDeployment: (input) => {
      const started = startDeployment(store.get(), input)
      if (!started.ok) return Promise.resolve(started)
      const cancelToken = crypto.randomUUID()
      store.cancelTokens().set(started.data.deployment.id, cancelToken)
      return Promise.resolve({ ok: true as const, data: { ...started.data, cancelToken } })
    },
    setDeploymentStage: (input) => Promise.resolve(setDeploymentStage(store.get(), input)),
    finishDeployment: (input) => Promise.resolve(finishDeployment(store.get(), input)),
    cancelDeployment: ({ deploymentId, cancelToken }) => {
      if (store.cancelTokens().get(deploymentId) !== cancelToken) {
        return Promise.resolve({
          ok: false as const,
          error: {
            code: 'INVALID_INPUT' as const,
            message: `No running deployment '${deploymentId}' that this cancel can stop.`,
          },
        })
      }
      return Promise.resolve(finishDeployment(store.get(), { deploymentId, status: 'cancelled' }))
    },
    // The in-memory twin of the DO's daily budget: same contract, no storage,
    // so a test can drive the cap without a Durable Object.
    modelUsage: (clientKey) => Promise.resolve(store.modelUsage(clientKey)),
    recordModelUsage: (tokens, clientKey) =>
      Promise.resolve(store.recordModelUsage(tokens, clientKey)),
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
