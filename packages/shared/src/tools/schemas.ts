/**
 * Input schemas and descriptions for the agent tools.
 * Source of truth: docs/tool-inventory.md — schemas and the quoted trigger
 * descriptions are transcribed verbatim; keep both in sync.
 *
 * Phase 3 ships the six read/query and rich-data tools (1–6). The gated write
 * tools (7–10) arrive with the HITL approval gates in Phase 5 and must never be
 * exposed ungated (docs/tool-inventory.md §3, ADR-0003).
 */
import { z } from 'zod'
import { ISSUE_STATUSES } from '../workspace/types'

export const issueStatusSchema = z.enum(ISSUE_STATUSES)
export const issueTypeSchema = z.enum(['feature', 'bug', 'chore', 'spike'])
export const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
export const environmentSchema = z.enum(['staging', 'production'])

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
export const TOOL_DESCRIPTIONS: Record<ReadToolName, string> = {
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

export const READ_TOOL_INPUT_SCHEMAS = {
  list_issues: listIssuesInputSchema,
  search_issues: searchIssuesInputSchema,
  get_sprint_status: getSprintStatusInputSchema,
  get_deployment_history: getDeploymentHistoryInputSchema,
  get_burndown: getBurndownInputSchema,
  diff_release_notes: diffReleaseNotesInputSchema,
} satisfies Record<ReadToolName, z.ZodType>

export type ListIssuesInput = z.infer<typeof listIssuesInputSchema>
export type SearchIssuesInput = z.infer<typeof searchIssuesInputSchema>
export type GetSprintStatusInput = z.infer<typeof getSprintStatusInputSchema>
export type GetDeploymentHistoryInput = z.infer<typeof getDeploymentHistoryInputSchema>
export type GetBurndownInput = z.infer<typeof getBurndownInputSchema>
export type DiffReleaseNotesInput = z.infer<typeof diffReleaseNotesInputSchema>
