/**
 * Domain model for the mock DevSprint workspace.
 * Source of truth: docs/domain-model.md — keep both in sync.
 *
 * Conventions: all timestamps are ISO-8601 UTC strings; ids are kebab-case
 * ('u-alice', 'sprint-12', 'dep-3'); issues are referenced by human key 'DS-<n>'.
 */

export const ISSUE_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

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
  | 'STAGE_FAILED'
  | 'INVALID_INPUT'

export interface ToolError {
  code: ToolErrorCode
  message: string
}

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: ToolError }
