/**
 * The write half of the workspace. Like the queries these are pure functions of
 * the snapshot plus the tool input, returning the shared `ToolResult` envelope
 * — but unlike the queries they mutate the workspace they are given, so they
 * must only ever be reached through an approved tool call (ADR-0003).
 *
 * Timestamps come from `workspace.now`, never `Date.now()`, so an approved
 * write lands on the fixed demo clock and the scripted scenarios stay
 * replayable.
 */
import type { Issue, ReleaseNote, ToolErrorCode, ToolResult, Workspace } from '@devsprint/shared'
import type {
  CreateIssueData,
  CreateIssueInput,
  CreateReleaseNotesData,
  CreateReleaseNotesInput,
  UpdateIssueStatusData,
  UpdateIssueStatusInput,
} from '@devsprint/shared/tools'

/**
 * Results are snapshots, not live references. The store is mutated in place, so
 * handing back the entity itself would let a later write in the same turn
 * retroactively change an earlier tool result the model still reads.
 */
function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data: structuredClone(data) }
}

function fail(code: ToolErrorCode, message: string): ToolResult<never> {
  return { ok: false, error: { code, message } }
}

/**
 * Actions the copilot performs are attributed to the agent rather than to a
 * team member (docs/domain-model.md §2).
 */
const AGENT_ACTOR = 'agent'

function keyNumber(key: string): number {
  return Number.parseInt(key.slice(key.lastIndexOf('-') + 1), 10)
}

/** Next free `DS-<n>`, one past the highest existing key. */
function nextIssueKey(workspace: Workspace): string {
  const highest = workspace.issues.reduce((max, issue) => Math.max(max, keyNumber(issue.key)), 0)
  return `DS-${highest + 1}`
}

// --- 7. create_issue ----------------------------------------------------------

export function createIssue(
  workspace: Workspace,
  input: CreateIssueInput,
): ToolResult<CreateIssueData> {
  if (
    input.sprintId !== null &&
    !workspace.sprints.some((sprint) => sprint.id === input.sprintId)
  ) {
    const known = workspace.sprints.map((sprint) => sprint.id).join(', ')
    return fail(
      'SPRINT_NOT_FOUND',
      `No sprint with id '${input.sprintId}'. Known sprints: ${known}.`,
    )
  }
  if (
    input.assigneeId !== undefined &&
    !workspace.users.some((user) => user.id === input.assigneeId)
  ) {
    const known = workspace.users.map((user) => user.id).join(', ')
    return fail('USER_NOT_FOUND', `No user with id '${input.assigneeId}'. Known users: ${known}.`)
  }

  const key = nextIssueKey(workspace)
  const issue: Issue = {
    id: key.toLowerCase(),
    key,
    projectId: workspace.project.id,
    sprintId: input.sprintId,
    title: input.title,
    description: input.description ?? '',
    type: input.type,
    status: 'todo',
    priority: input.priority,
    assigneeId: input.assigneeId ?? null,
    reporterId: AGENT_ACTOR,
    // Unestimated work is 0 points so it cannot silently inflate a sprint's
    // committed total, which the burndown and sprint status both derive from.
    points: input.points ?? 0,
    labels: input.labels ?? [],
    blockedReason: null,
    createdAt: workspace.now,
    updatedAt: workspace.now,
    completedAt: null,
  }
  workspace.issues.push(issue)
  return ok({ issue })
}

// --- 8. update_issue_status ---------------------------------------------------

export function updateIssueStatus(
  workspace: Workspace,
  input: UpdateIssueStatusInput,
): ToolResult<UpdateIssueStatusData> {
  const issue = workspace.issues.find(
    (candidate) => candidate.key.toLowerCase() === input.issueKey.trim().toLowerCase(),
  )
  if (!issue) {
    return fail(
      'ISSUE_NOT_FOUND',
      `No issue with key '${input.issueKey}'. Use search_issues to find the issue you meant.`,
    )
  }

  const previousStatus = issue.status
  if (previousStatus === input.status) {
    return fail('INVALID_INPUT', `${issue.key} is already ${input.status}.`)
  }

  issue.status = input.status
  issue.updatedAt = workspace.now
  // Completion drives completedPoints and the burndown, so it has to track the
  // status in both directions — reopening a done issue must un-complete it.
  issue.completedAt = input.status === 'done' ? workspace.now : null
  // Leaving a stale reason on an unblocked issue would misreport the board.
  if (input.status !== 'blocked') issue.blockedReason = null
  else if (input.comment !== undefined) issue.blockedReason = input.comment

  return ok({ issue, previousStatus })
}

// --- 9. create_release_notes --------------------------------------------------

export function createReleaseNotes(
  workspace: Workspace,
  input: CreateReleaseNotesInput,
): ToolResult<CreateReleaseNotesData> {
  if (workspace.releaseNotes.some((note) => note.version === input.version)) {
    return fail('VERSION_EXISTS', `Release notes for ${input.version} already exist.`)
  }
  if (
    input.sprintId !== undefined &&
    !workspace.sprints.some((sprint) => sprint.id === input.sprintId)
  ) {
    const known = workspace.sprints.map((sprint) => sprint.id).join(', ')
    // INVALID_INPUT rather than SPRINT_NOT_FOUND: tool 9's documented error set
    // is VERSION_EXISTS and INVALID_INPUT (docs/tool-inventory.md §2).
    return fail('INVALID_INPUT', `No sprint with id '${input.sprintId}'. Known sprints: ${known}.`)
  }

  const releaseNote: ReleaseNote = {
    id: `rn-${workspace.releaseNotes.length + 1}`,
    projectId: workspace.project.id,
    version: input.version,
    // This tool only ever drafts; publishing is deliberately not a tool
    // (docs/tool-inventory.md §4).
    status: 'draft',
    markdown: input.markdown,
    authorId: AGENT_ACTOR,
    createdAt: workspace.now,
    updatedAt: workspace.now,
  }
  workspace.releaseNotes.push(releaseNote)
  return ok({ releaseNote })
}
