/**
 * The workspace as the tool layer sees it: one async method per tool, each
 * returning the shared result envelope.
 *
 * It lives here, in types only, because two Workers meet across it —
 * `apps/api` backs it with the workspace Durable Object, and `apps/mcp-issues`
 * calls it through a cross-script binding. Neither package has to import the
 * other's source to agree on the contract.
 */
import type {
  DeploymentStatus,
  StageName,
  StageStatus,
  ToolResult,
  Workspace,
} from '../workspace/types'
import type {
  CreateIssueInput,
  CreateReleaseNotesInput,
  DiffReleaseNotesInput,
  GetBurndownInput,
  GetDeploymentHistoryInput,
  GetSprintStatusInput,
  ListIssuesInput,
  RunDeploymentInput,
  SearchIssuesInput,
  UpdateIssueStatusInput,
} from './schemas'
import type {
  BurndownData,
  CreateIssueData,
  CreateReleaseNotesData,
  DeploymentHistoryData,
  ListIssuesData,
  ReleaseNotesDiffData,
  RunDeploymentData,
  SearchIssuesData,
  SprintStatusData,
  UndoChangeData,
  UndoChangeInput,
  UpdateIssueStatusData,
} from './types'

export interface WorkspaceApi {
  /** The whole board, for the SPA's workspace pane. */
  snapshot(): Promise<Workspace>
  /**
   * Restores the seed — both the board and the approval ledger below. Called
   * from the manual reset control and, once a day, from the Worker's own alarm
   * (ADR-0014).
   */
  reset(): Promise<Workspace>

  /**
   * Spends each id in `ids`, returning whichever were already spent — by an
   * earlier call, or by an earlier occurrence of the same id within this one
   * — the actual replay guard behind a gated write (ADR-0010). Callers should
   * still deduplicate first where they can; this does not depend on it.
   * Persisted here rather than kept as an in-memory Set in the Worker
   * (ADR-0014): an isolate can restart, or a later request can land on a
   * different one, and either would otherwise let a captured approval replay.
   * Not an unconditional single-use guarantee, though — `reset` clears it, and
   * an implementation may cap its size and evict the oldest entries rather
   * than grow forever; both are documented, bounded trade-offs (ADR-0014), not
   * something a caller can assume away.
   */
  spendApprovals(ids: string[]): Promise<string[]>

  /**
   * The model tokens this demo has spent today, and the day they belong to.
   *
   * Lives beside the board rather than in the Worker for the same reason the
   * approval ledger does: it has to be global and it has to survive a restart,
   * or it is not a spend control. Unlike the board and the ledger it is *not*
   * cleared by `reset` — a cap a visitor can clear by pressing Reset is not a
   * cap (ADR-0016). It rolls over on the real UTC date instead.
   */
  modelUsage(): Promise<DailyModelUsage>
  recordModelUsage(tokens: number): Promise<DailyModelUsage>

  listIssues(input: ListIssuesInput): Promise<ToolResult<ListIssuesData>>
  searchIssues(input: SearchIssuesInput): Promise<ToolResult<SearchIssuesData>>
  getSprintStatus(input: GetSprintStatusInput): Promise<ToolResult<SprintStatusData>>
  getDeploymentHistory(input: GetDeploymentHistoryInput): Promise<ToolResult<DeploymentHistoryData>>
  getBurndown(input: GetBurndownInput): Promise<ToolResult<BurndownData>>
  diffReleaseNotes(input: DiffReleaseNotesInput): Promise<ToolResult<ReleaseNotesDiffData>>

  createIssue(input: CreateIssueInput): Promise<ToolResult<CreateIssueData>>
  updateIssueStatus(input: UpdateIssueStatusInput): Promise<ToolResult<UpdateIssueStatusData>>
  createReleaseNotes(input: CreateReleaseNotesInput): Promise<ToolResult<CreateReleaseNotesData>>

  /**
   * Reverses one recorded board write — `createIssue` or `updateIssueStatus`,
   * whose results carry the `changeId` — from the workspace's own record of
   * what it changed. One-shot, and refused with `UNDO_CONFLICT` once the issue
   * has moved on from what that write left, so it never overwrites a later
   * change. Not a tool: like reset, it is a person's action in the SPA.
   */
  undoChange(input: UndoChangeInput): Promise<ToolResult<UndoChangeData>>

  /**
   * A deployment runs over several seconds, so it is persisted in steps rather
   * than as one call: start it, move it through the stages, then settle it. The
   * simulation lives in the Worker; the workspace only records where it got to,
   * which is what lets the board show a cancelled run rather than losing it.
   */
  startDeployment(input: RunDeploymentInput): Promise<ToolResult<RunDeploymentData>>
  setDeploymentStage(input: SetDeploymentStageInput): Promise<ToolResult<RunDeploymentData>>
  finishDeployment(input: FinishDeploymentInput): Promise<ToolResult<RunDeploymentData>>
}

export interface DailyModelUsage {
  /** `YYYY-MM-DD`, in UTC. */
  day: string
  tokens: number
}

export interface SetDeploymentStageInput {
  deploymentId: string
  stage: StageName
  status: StageStatus
  logLine?: string
}

export interface FinishDeploymentInput {
  deploymentId: string
  status: Extract<DeploymentStatus, 'succeeded' | 'failed' | 'cancelled'>
}
