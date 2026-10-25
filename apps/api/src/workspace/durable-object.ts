import { DurableObject } from 'cloudflare:workers'
import {
  createWorkspaceSeed,
  WORKSPACE_DO_NAME,
  type ToolResult,
  type Workspace,
} from '@devsprint/shared'
import type {
  DailyModelUsage,
  WorkspaceApi,
  AssignIssueInput,
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
  UndoChangeInput,
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
  createReleaseNotes,
  finishDeployment,
  setDeploymentStage,
  startDeployment,
} from './mutations'
import {
  assignIssueTracked,
  createIssueTracked,
  undoChange,
  updateIssueStatusTracked,
  type BoardChange,
  type Tracked,
} from './changes'
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
 * What each recorded board write changed, for undo — bounded by `CHANGES_MAX`
 * in changes.ts. Its own key, saved in the same `put` as the board, so the two
 * can never disagree about whether a write or an undo happened.
 */
const CHANGES_KEY = 'board-changes'
/**
 * A ceiling on the serialized board, well under what the storage backend takes.
 * `WorkspaceDO` is registered under `new_sqlite_classes`, so the real limit is
 * the SQLite-backed one (~2 MiB per value), not the 128 KiB of the older
 * key-value backend. This sits far below either, because a demo board that has
 * grown past half a megabyte is already broken as a demo.
 */
const MAX_WORKSPACE_BYTES = 512_000
/**
 * Model tokens spent today. Deliberately its own key, and deliberately not
 * touched by `reset()`: the board and the ledger both mean "start the demo
 * over", but a budget a visitor can clear by pressing Reset is not a budget
 * (ADR-0016).
 */
const USAGE_KEY = 'daily-model-usage'

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
  /** Cached between calls, same as the workspace above. */
  private changes: BoardChange[] | undefined

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
    await this.ctx.storage.put(STORAGE_KEY, workspace)
    // Adopted only once the write has landed — see `mutate` for why.
    this.workspace = workspace
  }

  /**
   * Applies a mutation to a copy of the board and adopts it only once the
   * write has actually landed.
   *
   * The mutation functions edit the workspace in place, so running them
   * straight against the cached object commits the change to memory before
   * storage has agreed to it. When a write then fails, the cache keeps a
   * version storage never accepted — and because every later write persists
   * that same cached object, one rejected write poisons every write after it
   * until the object is evicted or reset. That is what turns an oversized
   * write from a single failed request into a board that stays broken.
   *
   * Working on a clone costs one copy of a ~12 KB object per write, against a
   * Durable Object that already serialises the whole board on every write.
   */
  private async mutate<T>(apply: (draft: Workspace) => ToolResult<T>): Promise<ToolResult<T>> {
    return this.commit((draft) => ({ result: apply(draft) }))
  }

  /**
   * `mutate`, for a write that also records itself for undo (or is one). The
   * journal it hands back is adopted on the same terms as the board: only once
   * storage has taken both, in one `put`, so a rejected write leaves neither a
   * change on the board nor a record of one.
   */
  private async commit<T>(
    apply: (draft: Workspace, changes: readonly BoardChange[]) => Tracked<T>,
  ): Promise<ToolResult<T>> {
    const draft = structuredClone(await this.load())
    const { result, changes } = apply(draft, await this.loadChanges())
    if (!result.ok) return result

    // A bound on the whole board, not just each field. Field-level limits in
    // `packages/shared/src/tools/schemas.ts` stop one huge string; this stops
    // the same cliff being reached a few hundred ordinary writes at a time,
    // which the public MCP server's ungated `create_issue` makes reachable.
    if (JSON.stringify(draft).length > MAX_WORKSPACE_BYTES) {
      return {
        ok: false,
        error: {
          code: 'WORKSPACE_FULL',
          message:
            'The demo board is full. Reset it to carry on — this is a bounded demo workspace, not durable storage.',
        },
      }
    }

    if (changes === undefined) {
      await this.save(draft)
    } else {
      await this.ctx.storage.put({ [STORAGE_KEY]: draft, [CHANGES_KEY]: changes })
      this.workspace = draft
      this.changes = changes
    }
    return result
  }

  private async loadChanges(): Promise<BoardChange[]> {
    this.changes ??= (await this.ctx.storage.get<BoardChange[]>(CHANGES_KEY)) ?? []
    return this.changes
  }

  /**
   * A fresh change id, and real wall-clock time like the reset alarm's — the
   * demo clock is for the board's own timestamps.
   */
  private stamp() {
    return { changeId: crypto.randomUUID(), at: new Date(Date.now()).toISOString() }
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
   *
   * The undo journal goes with the board, in the same write: its records name
   * issues the seed may not have, or has in a different state, so every undo
   * from before a reset is refused as unknown afterwards.
   */
  async reset(): Promise<Workspace> {
    const seeded = createWorkspaceSeed()
    await this.ctx.storage.put({ [STORAGE_KEY]: seeded, [CHANGES_KEY]: [] })
    this.workspace = seeded
    this.changes = []
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

  /** Real wall-clock UTC, like the reset alarm — not the frozen demo clock. */
  private today(): string {
    return new Date(Date.now()).toISOString().slice(0, 10)
  }

  /**
   * Rolls over by comparing the stored day to today rather than by being
   * cleared on a schedule, so a Worker that was asleep across midnight comes
   * back with a fresh budget without anything having had to fire.
   */
  private async loadUsage(): Promise<DailyModelUsage> {
    const stored = await this.ctx.storage.get<DailyModelUsage>(USAGE_KEY)
    const day = this.today()
    return stored && stored.day === day ? stored : { day, tokens: 0 }
  }

  async modelUsage(): Promise<DailyModelUsage> {
    return await this.loadUsage()
  }

  async recordModelUsage(tokens: number): Promise<DailyModelUsage> {
    const current = await this.loadUsage()
    // Negative or nonsense usage would quietly buy back budget.
    const spent = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0
    const next: DailyModelUsage = { day: current.day, tokens: current.tokens + spent }
    await this.ctx.storage.put(USAGE_KEY, next)
    return next
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
  // Each runs its mutation through `mutate`, which works on a copy and adopts it
  // only once storage has taken the write — so a rejected write leaves no trace
  // in storage *or* in the cache.
  //
  // The three issue writes also record what they changed as they land, whichever
  // client made them, so an approved card can offer an undo (changes.ts).

  async createIssue(input: CreateIssueInput) {
    const stamp = this.stamp()
    return this.commit((draft, changes) => createIssueTracked(draft, input, { changes, ...stamp }))
  }

  async updateIssueStatus(input: UpdateIssueStatusInput) {
    const stamp = this.stamp()
    return this.commit((draft, changes) =>
      updateIssueStatusTracked(draft, input, { changes, ...stamp }),
    )
  }

  async assignIssue(input: AssignIssueInput) {
    const stamp = this.stamp()
    return this.commit((draft, changes) => assignIssueTracked(draft, input, { changes, ...stamp }))
  }

  async undoChange(input: UndoChangeInput) {
    const { at } = this.stamp()
    return this.commit((draft, changes) => undoChange(draft, changes, input.changeId, at))
  }

  async createReleaseNotes(input: CreateReleaseNotesInput) {
    return this.mutate((draft) => createReleaseNotes(draft, input))
  }

  // A deployment is persisted a stage at a time, so a run that is cancelled or
  // interrupted leaves the board showing exactly how far it got.

  async startDeployment(input: RunDeploymentInput) {
    return this.mutate((draft) => startDeployment(draft, input))
  }

  async setDeploymentStage(input: SetDeploymentStageInput) {
    return this.mutate((draft) => setDeploymentStage(draft, input))
  }

  async finishDeployment(input: FinishDeploymentInput) {
    return this.mutate((draft) => finishDeployment(draft, input))
  }
}

/**
 * Every client talks to the same instance — there is one demo workspace. The
 * name is defined in `@devsprint/shared` because `apps/mcp-issues` resolves the
 * same object with it; re-exported here so existing callers keep their import.
 */
export { WORKSPACE_DO_NAME }

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
