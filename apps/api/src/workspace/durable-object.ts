import { DurableObject } from 'cloudflare:workers'
import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import type {
  WorkspaceApi,
  CreateIssueInput,
  CreateReleaseNotesInput,
  DiffReleaseNotesInput,
  GetBurndownInput,
  GetDeploymentHistoryInput,
  GetSprintStatusInput,
  ListIssuesInput,
  SearchIssuesInput,
  UpdateIssueStatusInput,
  RunDeploymentInput,
  SetDeploymentStageInput,
  FinishDeploymentInput,
} from '@devsprint/shared/tools'
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
import { nextUtcMidnightAfter } from './reset-schedule'

const STORAGE_KEY = 'workspace'
/** Approval ids already spent (ADR-0010), persisted alongside the board (ADR-0014). */
const LEDGER_KEY = 'spent-approvals'
/**
 * Caps the ledger's *count*, which only bounds its serialized size because
 * `approvals.ts`'s `MAX_APPROVAL_ID_LENGTH` bounds each entry's length first —
 * a count cap alone does not protect a 128 KiB per-value limit against a
 * caller that controls how long an id is. Worst case, every one of `LEDGER_MAX`
 * ids is at that 64-character ceiling: `1500 * (64 + 4 bytes of JSON overhead)
 * ≈ 102 KB`, comfortably under the 128 KiB Durable Object storage allows for
 * one value. Real ids are `crypto.randomUUID()`s (36 characters), so this
 * margin is never close in practice — it only matters against a client trying
 * to make it close.
 *
 * The ledger clears daily anyway, so evicting the oldest entries once it is
 * this large costs nothing in the case that matters (a quiet day never gets
 * close) and avoids `saveLedger` throwing on a very busy one instead.
 */
const LEDGER_MAX = 1500

/**
 * The one copy of the workspace.
 *
 * Until Phase 6 this was a module singleton, which was fine while a single
 * Worker owned every read and write. The public MCP server breaks that
 * assumption: two Workers, in different isolates, must see the same board, or
 * scenario S-F's "same workspace, two clients" is not true. A Durable Object is
 * the smallest thing that makes it true both locally and deployed.
 *
 * It also makes the write path correct rather than merely lucky. Allocating the
 * next `DS-<n>` key is a read-modify-write, and a Durable Object serialises
 * calls, so two clients filing an issue at once cannot both claim DS-14.
 *
 * The query and mutation functions are untouched: they are still pure functions
 * over a snapshot, they just run in here now.
 *
 * It also owns the demo's daily reset (ADR-0014). `ctx.storage.setAlarm` is
 * Cloudflare's own scheduling primitive — real wall-clock time, deliberately
 * not `workspace.now` — so the object arms one for the next UTC midnight as
 * soon as it exists, and `alarm()` below is what Cloudflare calls when it
 * fires.
 */
export class WorkspaceDO extends DurableObject implements WorkspaceApi {
  /** Cached between calls; storage is the source of truth across restarts. */
  private workspace: Workspace | undefined
  /** Cached between calls, same as the workspace above. */
  private ledger: Set<string> | undefined

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    // Nothing may run against this object until an alarm is armed, or a cold
    // start would go a day (or forever) without one. `blockConcurrencyWhile`
    // is what Cloudflare guarantees blocks every other call, constructors
    // included, until this resolves.
    void ctx.blockConcurrencyWhile(async () => {
      const existing = await ctx.storage.getAlarm()
      if (existing === null) await ctx.storage.setAlarm(nextUtcMidnightAfter(Date.now()))
    })
  }

  /** Cloudflare calls this when the armed alarm fires. */
  override async alarm(): Promise<void> {
    // Rearmed before resetting, not after: the one recurring alarm a Durable
    // Object can hold is spent once it fires, so the next day's reset does not
    // happen on its own. If reset() below were to throw, doing this first means
    // the object only misses today's reset rather than never resetting again —
    // Cloudflare retries a throwing alarm handler, but only a bounded number of
    // times before giving up on it for good.
    await this.ctx.storage.setAlarm(nextUtcMidnightAfter(Date.now()))
    await this.reset()
  }

  private async load(): Promise<Workspace> {
    this.workspace ??= (await this.ctx.storage.get<Workspace>(STORAGE_KEY)) ?? createWorkspaceSeed()
    return this.workspace
  }

  /** Persists after anything that mutates, so a restart keeps approved writes. */
  private async save(workspace: Workspace): Promise<void> {
    this.workspace = workspace
    await this.ctx.storage.put(STORAGE_KEY, workspace)
  }

  private async loadLedger(): Promise<Set<string>> {
    this.ledger ??= new Set(await this.ctx.storage.get<string[]>(LEDGER_KEY))
    return this.ledger
  }

  private async saveLedger(): Promise<void> {
    await this.ctx.storage.put(LEDGER_KEY, [...(this.ledger ?? [])])
  }

  async snapshot(): Promise<Workspace> {
    return await this.load()
  }

  /**
   * Restores the seed board and clears the ledger with it. The seed is fully
   * deterministic, so this is not a no-op for replay: a captured approval
   * naming DS-7 is naming the same DS-7 that exists right after a reset too, so
   * clearing the ledger really does let it replay once more. Accepted anyway —
   * this is a demo board with nothing at stake in that difference, and a
   * ledger that outlived the board it was protecting would keep denying
   * approvals against issues and deployments reset back to a shape they no
   * longer match. A real deployment would want the ledger scoped to something
   * a reset does not touch.
   */
  async reset(): Promise<Workspace> {
    const seeded = createWorkspaceSeed()
    await this.save(seeded)
    this.ledger = new Set()
    await this.saveLedger()
    return seeded
  }

  /**
   * Spent one at a time rather than filter-then-bulk-add, so a batch that
   * repeats one id inside itself is caught here too — `settleApprovals`
   * already deduplicates before calling this, but the guarantee should not
   * depend on every future caller remembering to.
   *
   * Builds the next ledger as its own copy and only commits it to `this.ledger`
   * once `saveLedger` has actually persisted it. Mutating the cached `Set`
   * directly, before the write is known to succeed, would let a failed
   * `ctx.storage.put` leave the in-memory cache and durable storage disagreeing
   * — this request would see ids as spent that a fresh load of the object, or a
   * retry after the object is evicted, would not.
   */
  async spendApprovals(ids: string[]): Promise<string[]> {
    const current = await this.loadLedger()
    const next = new Set(current)
    const alreadySpent: string[] = []
    for (const id of ids) {
      if (next.has(id)) {
        alreadySpent.push(id)
      } else {
        next.add(id)
      }
    }
    // Oldest first: a `Set` iterates in insertion order, so this is the
    // longest-spent ids, which is also the closest thing to "least likely to
    // still be sitting in a client's transcript waiting to replay."
    while (next.size > LEDGER_MAX) {
      const oldest = next.values().next().value
      if (oldest === undefined) break
      next.delete(oldest)
    }
    await this.ctx.storage.put(LEDGER_KEY, [...next])
    this.ledger = next
    return alreadySpent
  }

  // --- reads ------------------------------------------------------------------

  async listIssues(input: ListIssuesInput) {
    return listIssues(await this.load(), input)
  }

  async searchIssues(input: SearchIssuesInput) {
    return searchIssues(await this.load(), input)
  }

  async getSprintStatus(input: GetSprintStatusInput) {
    return getSprintStatus(await this.load(), input)
  }

  async getDeploymentHistory(input: GetDeploymentHistoryInput) {
    return getDeploymentHistory(await this.load(), input)
  }

  async getBurndown(input: GetBurndownInput) {
    return getBurndown(await this.load(), input)
  }

  async diffReleaseNotes(input: DiffReleaseNotesInput) {
    return diffReleaseNotes(await this.load(), input)
  }

  // --- writes -----------------------------------------------------------------
  //
  // Each mutates the loaded workspace and persists it. Failures return the error
  // envelope without touching storage, so a rejected write leaves no trace.

  async createIssue(input: CreateIssueInput) {
    const workspace = await this.load()
    const result = createIssue(workspace, input)
    if (result.ok) await this.save(workspace)
    return result
  }

  async updateIssueStatus(input: UpdateIssueStatusInput) {
    const workspace = await this.load()
    const result = updateIssueStatus(workspace, input)
    if (result.ok) await this.save(workspace)
    return result
  }

  async createReleaseNotes(input: CreateReleaseNotesInput) {
    const workspace = await this.load()
    const result = createReleaseNotes(workspace, input)
    if (result.ok) await this.save(workspace)
    return result
  }

  // A deployment is persisted a stage at a time, so a run that is cancelled or
  // interrupted leaves the board showing exactly how far it got.

  async startDeployment(input: RunDeploymentInput) {
    const workspace = await this.load()
    const result = startDeployment(workspace, input)
    if (result.ok) await this.save(workspace)
    return result
  }

  async setDeploymentStage(input: SetDeploymentStageInput) {
    const workspace = await this.load()
    const result = setDeploymentStage(workspace, input)
    if (result.ok) await this.save(workspace)
    return result
  }

  async finishDeployment(input: FinishDeploymentInput) {
    const workspace = await this.load()
    const result = finishDeployment(workspace, input)
    if (result.ok) await this.save(workspace)
    return result
  }
}

/** Every client talks to the same instance — there is one demo workspace. */
export const WORKSPACE_DO_NAME = 'demo'

export interface WorkspaceBinding {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub<WorkspaceDO>
}

/**
 * Handle to the shared workspace. One name, deliberately, rather than a
 * per-visitor session key: the product brief lists multi-tenancy as a
 * non-goal, and the external MCP host has no session of its own to key on —
 * scenario S-F needs it to land in the exact object the SPA reads from, not
 * one scoped to whichever browser happened to be open (ADR-0014). Callers
 * still go through this rather than inlining the name, so the one place that
 * could change stays one place.
 */
export function workspaceStub(binding: WorkspaceBinding): DurableObjectStub<WorkspaceDO> {
  return binding.get(binding.idFromName(WORKSPACE_DO_NAME))
}

export type { WorkspaceApi }
