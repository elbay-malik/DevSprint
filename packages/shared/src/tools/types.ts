/**
 * Output payloads of the agent tools (the `data` half of `ToolResult<T>`).
 * Source of truth: docs/tool-inventory.md §2 — keep in sync.
 */
import type {
  Deployment,
  Issue,
  IssueStatus,
  ReleaseNote,
  Sprint,
  ToolResult,
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

export type IssueSummary = Pick<
  Issue,
  'key' | 'title' | 'status' | 'priority' | 'points' | 'assigneeId' | 'sprintId' | 'labels'
>

export interface ListIssuesData {
  issues: IssueSummary[]
}

export interface SearchIssuesMatch {
  key: string
  title: string
  status: IssueStatus
  /** Relevance in [0, 1]; 1 is an exact key match. */
  score: number
}

export interface SearchIssuesData {
  matches: SearchIssuesMatch[]
}

export interface SprintStats {
  committedPoints: number
  completedPoints: number
  remainingPoints: number
  /** Calendar days from WORKSPACE_NOW to the sprint end date, never negative. */
  daysRemaining: number
  issueCountsByStatus: Record<IssueStatus, number>
  blockedIssueKeys: string[]
}

export interface SprintStatusData {
  sprint: Sprint
  stats: SprintStats
}

export type DeploymentSummary = Pick<
  Deployment,
  'id' | 'environment' | 'version' | 'status' | 'startedAt' | 'finishedAt' | 'triggeredById'
>

export interface DeploymentHistoryData {
  deployments: DeploymentSummary[]
}

export interface BurndownDay {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string
  remaining: number
  ideal: number
}

export interface BurndownData {
  sprintId: string
  unit: 'points'
  committedPoints: number
  /** The fixed demo clock the series was computed against (WORKSPACE_NOW). */
  asOf: string
  days: BurndownDay[]
}

export type SectionChangeType = 'added' | 'removed' | 'modified'

export interface ChangedSection {
  heading: string
  changeType: SectionChangeType
}

export interface ReleaseNotesDiffData {
  baseVersion: string
  before: string
  after: string
  changedSections: ChangedSection[]
}

export interface CreateIssueData {
  issue: Issue
}

export interface UpdateIssueStatusData {
  issue: Issue
  previousStatus: IssueStatus
}

export interface CreateReleaseNotesData {
  releaseNote: ReleaseNote
}

/**
 * `run_deployment` yields this repeatedly while the job runs and once more when
 * it settles, so every snapshot has the same shape — the stages carry their own
 * status and log tail, which is all the progress card needs to draw itself.
 */
export interface RunDeploymentData {
  deployment: Deployment
}

/**
 * Tool name → { input, output } map, shaped for the AI SDK's `UITools`
 * constraint so the SPA can type its `UIMessage` parts (`tool-list_issues`, …)
 * without depending on the api package. Must be a type alias, not an
 * interface, to satisfy the `Record<string, …>` constraint.
 */
export type DevSprintUITools = {
  list_issues: { input: ListIssuesInput; output: ToolResult<ListIssuesData> }
  search_issues: { input: SearchIssuesInput; output: ToolResult<SearchIssuesData> }
  get_sprint_status: { input: GetSprintStatusInput; output: ToolResult<SprintStatusData> }
  get_deployment_history: {
    input: GetDeploymentHistoryInput
    output: ToolResult<DeploymentHistoryData>
  }
  get_burndown: { input: GetBurndownInput; output: ToolResult<BurndownData> }
  diff_release_notes: { input: DiffReleaseNotesInput; output: ToolResult<ReleaseNotesDiffData> }
  create_issue: { input: CreateIssueInput; output: ToolResult<CreateIssueData> }
  update_issue_status: {
    input: UpdateIssueStatusInput
    output: ToolResult<UpdateIssueStatusData>
  }
  create_release_notes: {
    input: CreateReleaseNotesInput
    output: ToolResult<CreateReleaseNotesData>
  }
  run_deployment: { input: RunDeploymentInput; output: ToolResult<RunDeploymentData> }
}
