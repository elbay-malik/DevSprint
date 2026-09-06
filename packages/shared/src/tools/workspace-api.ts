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
  UpdateIssueStatusData,
} from './types'

export interface WorkspaceApi {
  /** The whole board, for the SPA's workspace pane. */
  snapshot(): Promise<Workspace>
  /** Restores the seed. */
  reset(): Promise<Workspace>

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
   * A deployment runs over several seconds, so it is persisted in steps rather
   * than as one call: start it, move it through the stages, then settle it. The
   * simulation lives in the Worker; the workspace only records where it got to,
   * which is what lets the board show a cancelled run rather than losing it.
   */
  startDeployment(input: RunDeploymentInput): Promise<ToolResult<RunDeploymentData>>
  setDeploymentStage(input: SetDeploymentStageInput): Promise<ToolResult<RunDeploymentData>>
  finishDeployment(input: FinishDeploymentInput): Promise<ToolResult<RunDeploymentData>>
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
