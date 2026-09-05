/**
 * The workspace as the tool layer sees it: one async method per tool, each
 * returning the shared result envelope.
 *
 * It lives here, in types only, because two Workers meet across it —
 * `apps/api` backs it with the workspace Durable Object, and `apps/mcp-issues`
 * calls it through a cross-script binding. Neither package has to import the
 * other's source to agree on the contract.
 */
import type { ToolResult, Workspace } from '../workspace/types'
import type {
  CreateIssueInput,
  CreateReleaseNotesInput,
  DiffReleaseNotesInput,
  GetBurndownInput,
  GetDeploymentHistoryInput,
  GetSprintStatusInput,
  ListIssuesInput,
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
}
