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
    'Use when the user asks to draft or write release notes, or to compare a draft with the last published version: compose the markdown yourself (from done issues) and pass it in, so the user sees the change before anything is saved.',
  create_issue:
    'Use when the user asks to add, file, or log a new issue, bug, task, or spike in the workspace.',
  update_issue_status:
    'Use when the user asks to move, close, block, unblock, or reopen an existing issue (any status change).',
  create_release_notes:
    'Use when the user asks to save or publish release notes they have already been shown — not to draft them, which is diff_release_notes. Pass the markdown the user saw.',
  run_deployment:
    'Use when the user asks to deploy, ship, release, or roll out a version to an environment.',
}

/**
 * Length bounds on everything a client supplies.
 *
 * Not cosmetic validation. The whole workspace is persisted as a single Durable
 * Object value (ADR-0011), and `apps/mcp-issues` exposes `create_issue` and
 * `update_issue_status` publicly with no approval gate — the MCP host owns that
 * prompt, not us. So one well-formed request with a multi-megabyte string can
 * push the stored workspace past the storage ceiling, after which *every* later
 * write fails for *every* visitor until someone resets the board. A single
 * request does it, so per-IP rate limiting (Phase 11) would not help.
 *
 * `approvals.ts` already bounds an approval id for exactly this reason, one
 * level down and against a much smaller value. These are the same argument
 * applied to the field that actually carries the bulk.
 *
 * The numbers are generous for real use and small against the ceiling: the seed
 * board is ~12 KB, and the worst case a client can force here is a few hundred.
 */
const LIMITS = {
  /** A one-line summary, not a body. */
  title: 200,
  /** Issue body. Long enough for a real write-up. */
  description: 4_000,
  /** A note attached to a status change. */
  comment: 500,
  /** Release notes are the one place a client legitimately sends prose. */
  markdown: 20_000,
  /** `v1.5.0-rc.1` and friends. */
  version: 40,
  /** `DS-7`. */
  issueKey: 32,
  /** `sprint-12`, `user-3` — ids we mint, not free text. */
  id: 64,
  /** Free-form, but neither long nor many. */
  label: 40,
  labelCount: 10,
  /** A search phrase. */
  query: 200,
} as const

export const listIssuesInputSchema = z.object({
  sprintId: z.string().max(LIMITS.id).optional(),
  status: issueStatusSchema.optional(),
  assigneeId: z.string().max(LIMITS.id).optional(),
  type: issueTypeSchema.optional(),
  label: z.string().max(LIMITS.label).optional(),
  limit: z.number().int().positive().max(200).default(50),
})

export const searchIssuesInputSchema = z.object({
  query: z.string().min(1).max(LIMITS.query),
  limit: z.number().int().positive().max(200).default(10),
})

export const getSprintStatusInputSchema = z.object({
  /** Defaults to the active sprint. */
  sprintId: z.string().max(LIMITS.id).optional(),
})

export const getDeploymentHistoryInputSchema = z.object({
  environment: environmentSchema.optional(),
  limit: z.number().int().positive().max(200).default(5),
})

export const getBurndownInputSchema = z.object({
  /** Defaults to the active sprint. */
  sprintId: z.string().max(LIMITS.id).optional(),
})

export const diffReleaseNotesInputSchema = z.object({
  draftMarkdown: z.string().min(1).max(LIMITS.markdown),
  /** Defaults to the latest published release note. */
  baseVersion: z.string().max(LIMITS.version).optional(),
})

export const createIssueInputSchema = z.object({
  title: z.string().min(1).max(LIMITS.title),
  description: z.string().max(LIMITS.description).optional(),
  type: issueTypeSchema,
  priority: prioritySchema.default('medium'),
  /** null puts the issue in the backlog. */
  sprintId: z.string().max(LIMITS.id).nullable().default(null),
  assigneeId: z.string().max(LIMITS.id).optional(),
  points: z.number().int().positive().max(100).optional(),
  labels: z.array(z.string().max(LIMITS.label)).max(LIMITS.labelCount).optional(),
})

export const updateIssueStatusInputSchema = z.object({
  /** Human key, e.g. 'DS-7'. */
  issueKey: z.string().max(LIMITS.issueKey),
  status: issueStatusSchema,
  comment: z.string().max(LIMITS.comment).optional(),
})

export const createReleaseNotesInputSchema = z.object({
  /** e.g. 'v1.5.0'. */
  version: z.string().max(LIMITS.version),
  markdown: z.string().min(1).max(LIMITS.markdown),
  sprintId: z.string().max(LIMITS.id).optional(),
})

export const runDeploymentInputSchema = z.object({
  environment: environmentSchema,
  version: z.string().max(LIMITS.version),
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
