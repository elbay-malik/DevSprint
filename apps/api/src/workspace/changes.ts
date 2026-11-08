/**
 * Undo for an applied board write.
 *
 * The record of what a write changed is taken here, by the workspace, at the
 * moment the write lands — never from the client. The SPA only ever sends back
 * the `changeId` the write's result carried; the before and after it names are
 * the workspace's own. Pure functions over a snapshot and the journal, like the
 * queries and mutations, so the Durable Object and the in-memory test store
 * share one implementation.
 *
 * Keyed by an id the workspace mints rather than by the SDK's tool call id,
 * because the issue writes usually arrive over MCP (ADR-0002) and the MCP hop
 * carries the arguments, not the call id. The id travelling in the result is
 * what both paths — and an external MCP host — have in common.
 */
import type { Issue, IssueSource, ToolResult, Workspace } from '@devsprint/shared'
import type {
  AssignIssueData,
  AssignIssueInput,
  CreateIssueData,
  CreateIssueInput,
  UndoableToolName,
  UndoChangeData,
  UpdateIssueStatusData,
  UpdateIssueStatusInput,
} from '@devsprint/shared/tools'
import { assignIssue, createIssue, updateIssueStatus } from './mutations'

/**
 * The issue fields a board write can change, and so the ones an undo puts back
 * and checks against. Every recorded write snapshots all four, whichever it
 * touched: that is what makes a status write refuse to undo over a later
 * reassignment, and a reassignment refuse to undo over a later status change.
 */
export type ChangedFields = Pick<Issue, 'status' | 'assigneeId' | 'blockedReason' | 'completedAt'>

export interface BoardChange {
  id: string
  tool: UndoableToolName
  issueKey: string
  /** Null for a created issue: undoing it removes the issue. */
  before: ChangedFields | null
  after: ChangedFields
  /** Real wall-clock time, ISO-8601 UTC. */
  appliedAt: string
  undoneAt: string | null
}

/**
 * Bounds a client-supplied id before it is compared against anything, the same
 * ceiling `approvals.ts` puts on an approval id. Real ids are
 * `crypto.randomUUID()`s (36 characters) and only ever minted here, so nothing
 * a client sends is stored — the bound is about refusing junk early and
 * plainly, not about storage.
 */
export const MAX_CHANGE_ID_LENGTH = 64
const CHANGE_ID_PATTERN = /^[A-Za-z0-9-]+$/

/**
 * Caps the journal's count, oldest evicted first. Every field in an entry is
 * either minted here or bounded by the tool schemas, so the worst entry — a
 * status change carrying a 500-character blocked reason on both sides — is
 * about 1.3 KB, and `300 * 1.3 KB ≈ 390 KB` stays well under the ~2 MiB a
 * SQLite-backed Durable Object value allows. A typical entry is a fifth of
 * that. It clears on reset with the board, so a quiet day never comes close.
 */
export const CHANGES_MAX = 300

/** A write plus the journal it leaves behind, when it changed one. */
export interface Tracked<T> {
  result: ToolResult<T>
  changes?: BoardChange[]
}

function fail(message: string, code: 'UNDO_CONFLICT' | 'INVALID_INPUT' = 'UNDO_CONFLICT') {
  return { result: { ok: false as const, error: { code, message } } }
}

function fieldsOf(issue: Issue): ChangedFields {
  return {
    status: issue.status,
    assigneeId: issue.assigneeId,
    blockedReason: issue.blockedReason,
    completedAt: issue.completedAt,
  }
}

function sameFields(a: ChangedFields, b: ChangedFields): boolean {
  return (
    a.status === b.status &&
    a.assigneeId === b.assigneeId &&
    a.blockedReason === b.blockedReason &&
    a.completedAt === b.completedAt
  )
}

/** Same matching the issue writes use, so the before-state is the issue they are about to write. */
function findIssue(workspace: Workspace, key: string): Issue | undefined {
  const wanted = key.trim().toLowerCase()
  return workspace.issues.find((issue) => issue.key.toLowerCase() === wanted)
}

/** Appends without touching the journal it was given; the caller adopts the copy once it is saved. */
export function appendChange(changes: readonly BoardChange[], change: BoardChange): BoardChange[] {
  const next = [...changes, change]
  return next.length > CHANGES_MAX ? next.slice(next.length - CHANGES_MAX) : next
}

interface TrackOptions {
  changes: readonly BoardChange[]
  /** Minted by the caller, so a test can name it. */
  changeId: string
  /** Real wall-clock time, ISO-8601 UTC. */
  at: string
}

export function createIssueTracked(
  workspace: Workspace,
  input: CreateIssueInput,
  { changes, changeId, at }: TrackOptions,
  source: IssueSource = 'app',
): Tracked<CreateIssueData> {
  const result = createIssue(workspace, input, source)
  if (!result.ok) return { result }
  const { issue } = result.data
  return {
    result: { ok: true, data: { ...result.data, changeId } },
    changes: appendChange(changes, {
      id: changeId,
      tool: 'create_issue',
      issueKey: issue.key,
      before: null,
      after: fieldsOf(issue),
      appliedAt: at,
      undoneAt: null,
    }),
  }
}

export function updateIssueStatusTracked(
  workspace: Workspace,
  input: UpdateIssueStatusInput,
  { changes, changeId, at }: TrackOptions,
): Tracked<UpdateIssueStatusData> {
  // Read off the board before the write runs: this, not the client's copy of
  // the card, is what an undo will put back.
  const target = findIssue(workspace, input.issueKey)
  const before = target ? fieldsOf(target) : undefined
  const result = updateIssueStatus(workspace, input)
  if (!result.ok || before === undefined) return { result }
  const { issue } = result.data
  return {
    result: { ok: true, data: { ...result.data, changeId } },
    changes: appendChange(changes, {
      id: changeId,
      tool: 'update_issue_status',
      issueKey: issue.key,
      before,
      after: fieldsOf(issue),
      appliedAt: at,
      undoneAt: null,
    }),
  }
}

export function assignIssueTracked(
  workspace: Workspace,
  input: AssignIssueInput,
  { changes, changeId, at }: TrackOptions,
): Tracked<AssignIssueData> {
  // Same as a status change: the before-state is the board's, so undoing a
  // first assignment puts the issue back to nobody rather than to a guess.
  const target = findIssue(workspace, input.issueKey)
  const before = target ? fieldsOf(target) : undefined
  const result = assignIssue(workspace, input)
  if (!result.ok || before === undefined) return { result }
  const { issue } = result.data
  return {
    result: { ok: true, data: { ...result.data, changeId } },
    changes: appendChange(changes, {
      id: changeId,
      tool: 'assign_issue',
      issueKey: issue.key,
      before,
      after: fieldsOf(issue),
      appliedAt: at,
      undoneAt: null,
    }),
  }
}

/**
 * Applies the inverse of one recorded change, or refuses.
 *
 * Refused, rather than forced, whenever something has changed the issue since:
 * an undo is "put back what that approval did", and putting back the old fields
 * over a later change would silently overwrite it. Two checks, because neither
 * is enough alone. A later recorded write to the same key that is still
 * standing refuses outright — field equality cannot see A→B→A→B, and a key
 * freed by undoing a create is minted again for the next one (`nextIssueKey`),
 * so a record could otherwise land on an unrelated issue. And the issue must
 * still read exactly what the write left, which catches a write the journal
 * never saw. Undoing the later change first clears both, so a chain still
 * unwinds in order.
 */
export function undoChange(
  workspace: Workspace,
  changes: readonly BoardChange[],
  changeId: unknown,
  at: string,
): Tracked<UndoChangeData> {
  if (
    typeof changeId !== 'string' ||
    changeId.length === 0 ||
    changeId.length > MAX_CHANGE_ID_LENGTH ||
    !CHANGE_ID_PATTERN.test(changeId)
  ) {
    return fail('That is not a change id.', 'INVALID_INPUT')
  }

  const index = changes.findIndex((change) => change.id === changeId)
  const change = changes[index]
  if (change === undefined) {
    return fail(
      'There is no record of that change. The board may have been reset since, or it was not one that can be undone.',
    )
  }
  if (change.undoneAt !== null) return fail(`That change to ${change.issueKey} was already undone.`)

  const key = change.issueKey.toLowerCase()
  const superseded = changes
    .slice(index + 1)
    .some((later) => later.undoneAt === null && later.issueKey.toLowerCase() === key)
  const issue = findIssue(workspace, change.issueKey)
  if (superseded || !issue || !sameFields(fieldsOf(issue), change.after)) {
    return fail(`${change.issueKey} has changed since, so that change was not undone.`)
  }

  if (change.before === null) {
    workspace.issues.splice(workspace.issues.indexOf(issue), 1)
  } else {
    Object.assign(issue, change.before)
    issue.updatedAt = workspace.now
  }

  const undone: BoardChange = { ...change, undoneAt: at }
  return {
    result: {
      ok: true,
      data: {
        changeId,
        tool: change.tool,
        issueKey: change.issueKey,
        outcome: change.before === null ? 'removed' : 'restored',
        issue: change.before === null ? null : structuredClone(issue),
        undoneAt: at,
      },
    },
    // Kept, marked undone, rather than dropped: a second undo should hear
    // "already undone", not "never heard of it".
    changes: changes.map((entry, position) => (position === index ? undone : entry)),
  }
}
