/**
 * Domain model for the mock DevSprint workspace.
 * Source of truth: docs/domain-model.md — keep both in sync.
 *
 * Conventions: all timestamps are ISO-8601 UTC strings; ids are kebab-case
 * ('u-alice', 'sprint-12', 'dep-3'); issues are referenced by human key 'DS-<n>'.
 */

export const ISSUE_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

/**
 * The board's column names, which is what the copilot calls a status when it
 * talks to a person. The raw `in_review` is for tool arguments only. The web
 * app holds the same words in features/workspace/lib/status-labels.ts.
 */
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  in_review: 'In review',
  blocked: 'Blocked',
  done: 'Done',
}

export type IssueType = 'feature' | 'bug' | 'chore' | 'spike'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type SprintState = 'planned' | 'active' | 'completed'
export type Environment = 'staging' | 'production'
export type DeploymentStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type StageName = 'build' | 'test' | 'migrate' | 'release'
export type StageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

export interface User {
  id: string
  name: string
  handle: string
  role: 'tech_lead' | 'engineer' | 'devops' | 'product'
  avatarColor: string
}

export interface Project {
  id: string
  key: string
  name: string
  description: string
}

export interface Sprint {
  id: string
  projectId: string
  name: string
  goal: string
  state: SprintState
  startDate: string
  endDate: string
}

/**
 * Which way an issue reached the board. `app` is the in-app copilot, through an
 * approval card; `mcp` is an external host on the public MCP endpoint, which
 * has no approval card and no account. Stored only as `mcp`: an issue with no
 * `source` (the seed, and everything created before the field existed) is
 * `app`, so older boards read the same as they always did.
 */
export type IssueSource = 'app' | 'mcp'

export interface Issue {
  id: string
  key: string
  projectId: string
  sprintId: string | null
  title: string
  description: string
  type: IssueType
  status: IssueStatus
  priority: Priority
  assigneeId: string | null
  reporterId: string
  points: number
  labels: string[]
  blockedReason: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  /** Absent means `app` (see `IssueSource`). */
  source?: 'mcp'
}

/** Where an issue came from, reading an absent `source` as the in-app copilot. */
export function issueSource(issue: Pick<Issue, 'source'>): IssueSource {
  return issue.source === 'mcp' ? 'mcp' : 'app'
}

export interface DeploymentStage {
  name: StageName
  status: StageStatus
  startedAt: string | null
  finishedAt: string | null
  logTail: string[]
}

export interface Deployment {
  id: string
  projectId: string
  environment: Environment
  version: string
  status: DeploymentStatus
  stages: DeploymentStage[]
  triggeredById: string
  commitSha: string
  startedAt: string
  finishedAt: string | null
}

export interface ReleaseNote {
  id: string
  projectId: string
  version: string
  /** The sprint these notes cover, when the author named one. */
  sprintId: string | null
  status: 'draft' | 'published'
  markdown: string
  authorId: string
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  now: string
  project: Project
  users: User[]
  sprints: Sprint[]
  issues: Issue[]
  deployments: Deployment[]
  releaseNotes: ReleaseNote[]
}

/** Result envelope every tool returns (see docs/domain-model.md). */
export type ToolErrorCode =
  | 'ISSUE_NOT_FOUND'
  | 'SPRINT_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'VERSION_EXISTS'
  | 'DEPLOY_IN_PROGRESS'
  | 'DEPLOY_ALREADY_SETTLED'
  | 'STAGE_FAILED'
  /** The demo board has grown past what one Durable Object value should hold. */
  | 'WORKSPACE_FULL'
  /**
   * An undo the board can no longer honour: the issue has changed since, the
   * change was already undone, or there is no record of it (a reset clears
   * them all).
   */
  | 'UNDO_CONFLICT'
  /** A visitor's reset that came too soon after the last one. */
  | 'RESET_COOLDOWN'
  | 'INVALID_INPUT'
  /**
   * The issues MCP server's answer to a failure it did not expect, such as the
   * Durable Object being unreachable. The detail goes to its log, not the caller.
   */
  | 'INTERNAL'

export interface ToolError {
  code: ToolErrorCode
  message: string
}

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: ToolError }
