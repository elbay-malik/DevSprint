/**
 * Input schemas and descriptions for the agent tools.
 * Source of truth: docs/tool-inventory.md — schemas and the quoted trigger
 * descriptions are transcribed verbatim; keep both in sync.
 *
 * Tools 1–6 are read/query and rich-data: they always auto-execute. Tools 7–9
 * are gated writes — they only run after explicit human approval, with no
 * exceptions and no batching (docs/tool-inventory.md §3, ADR-0003). Tool 10,
 * `run_deployment`, is gated the same way and additionally streams progress
 * while it runs.
 */
import { z } from 'zod'
import { ISSUE_STATUSES } from '../workspace/types'

export const issueStatusSchema = z.enum(ISSUE_STATUSES)
export const issueTypeSchema = z.enum(['feature', 'bug', 'chore', 'spike'])
export const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
export const environmentSchema = z.enum(['staging', 'production'])

export const WRITE_TOOL_NAMES = [
  'create_issue',
  'update_issue_status',
  'create_release_notes',
  'run_deployment',
] as const
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number]

export const READ_TOOL_NAMES = [
  'list_issues',
  'search_issues',
  'get_sprint_status',
  'get_deployment_history',
  'get_burndown',
  'diff_release_notes',
] as const
export type ReadToolName = (typeof READ_TOOL_NAMES)[number]

/** Trigger-condition descriptions, verbatim from docs/tool-inventory.md §2. */
export const TOOL_DESCRIPTIONS: Record<ReadToolName | WriteToolName, string> = {
  list_issues:
    'Use when the user asks what issues exist or wants a filtered view of issues by sprint, status, assignee, type, or label.',
  search_issues:
    'Use when the user refers to an issue by words, topic, or a partial/uncertain key and you need to find matching issues by fuzzy text.',
  get_sprint_status:
    'Use when the user asks how a sprint is going, its health, capacity, blockers, or what remains.',
  get_deployment_history:
    'Use when the user asks what was deployed, when, to which environment, or whether a past deploy succeeded or failed.',
  get_burndown:
    'Use when the user asks whether a sprint is on track, asks about trend/velocity, or requests a burndown or progress chart.',
  diff_release_notes:
    'Use when the user wants to compare draft release notes against the last published version before saving or publishing.',
  create_issue:
    'Use when the user asks to add, file, or log a new issue, bug, task, or spike in the workspace.',
  update_issue_status:
    'Use when the user asks to move, close, block, unblock, or reopen an existing issue (any status change).',
  create_release_notes:
    'Use when the user asks to draft or save release notes for a version. The agent composes the markdown itself (from done issues) and passes it in.',
  run_deployment:
    'Use when the user asks to deploy, ship, release, or roll out a version to an environment.',
}

export const listIssuesInputSchema = z.object({
  sprintId: z.string().optional(),
  status: issueStatusSchema.optional(),
  assigneeId: z.string().optional(),
  type: issueTypeSchema.optional(),
  label: z.string().optional(),
  limit: z.number().int().positive().default(50),
})

export const searchIssuesInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().default(10),
})

export const getSprintStatusInputSchema = z.object({
  /** Defaults to the active sprint. */
  sprintId: z.string().optional(),
})

export const getDeploymentHistoryInputSchema = z.object({
  environment: environmentSchema.optional(),
  limit: z.number().int().positive().default(5),
})

export const getBurndownInputSchema = z.object({
  /** Defaults to the active sprint. */
  sprintId: z.string().optional(),
})

export const diffReleaseNotesInputSchema = z.object({
  draftMarkdown: z.string().min(1),
  /** Defaults to the latest published release note. */
  baseVersion: z.string().optional(),
})

export const createIssueInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: issueTypeSchema,
  priority: prioritySchema.default('medium'),
  /** null puts the issue in the backlog. */
  sprintId: z.string().nullable().default(null),
  assigneeId: z.string().optional(),
  points: z.number().int().positive().optional(),
  labels: z.array(z.string()).optional(),
})

export const updateIssueStatusInputSchema = z.object({
  /** Human key, e.g. 'DS-7'. */
  issueKey: z.string(),
  status: issueStatusSchema,
  comment: z.string().optional(),
})

export const createReleaseNotesInputSchema = z.object({
  /** e.g. 'v1.5.0'. */
  version: z.string(),
  markdown: z.string().min(1),
  sprintId: z.string().optional(),
})

export const runDeploymentInputSchema = z.object({
  environment: environmentSchema,
  version: z.string(),
  /** Only ever on an explicit request from the user. */
  skipTests: z.boolean().default(false),
})

export const READ_TOOL_INPUT_SCHEMAS = {
  list_issues: listIssuesInputSchema,
  search_issues: searchIssuesInputSchema,
  get_sprint_status: getSprintStatusInputSchema,
  get_deployment_history: getDeploymentHistoryInputSchema,
  get_burndown: getBurndownInputSchema,
  diff_release_notes: diffReleaseNotesInputSchema,
} satisfies Record<ReadToolName, z.ZodType>

export const WRITE_TOOL_INPUT_SCHEMAS = {
  create_issue: createIssueInputSchema,
  update_issue_status: updateIssueStatusInputSchema,
  create_release_notes: createReleaseNotesInputSchema,
  run_deployment: runDeploymentInputSchema,
} satisfies Record<WriteToolName, z.ZodType>

export type ListIssuesInput = z.infer<typeof listIssuesInputSchema>
export type SearchIssuesInput = z.infer<typeof searchIssuesInputSchema>
export type GetSprintStatusInput = z.infer<typeof getSprintStatusInputSchema>
export type GetDeploymentHistoryInput = z.infer<typeof getDeploymentHistoryInputSchema>
export type GetBurndownInput = z.infer<typeof getBurndownInputSchema>
export type DiffReleaseNotesInput = z.infer<typeof diffReleaseNotesInputSchema>
export type CreateIssueInput = z.infer<typeof createIssueInputSchema>
export type UpdateIssueStatusInput = z.infer<typeof updateIssueStatusInputSchema>
export type CreateReleaseNotesInput = z.infer<typeof createReleaseNotesInputSchema>
export type RunDeploymentInput = z.infer<typeof runDeploymentInputSchema>
