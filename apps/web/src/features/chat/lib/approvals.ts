import type { IssueStatus } from '@devsprint/shared'
import { findIssueByKey } from '@/features/workspace/lib/issue-key'
import { isKnownAssignee } from '@/features/workspace/lib/people'

/**
 * What an approval card says once it is decided, as plain data, so the card's
 * outcome line and the transcript's status announcement are the same words. A
 * screen reader hearing "Approved by you." while the card reads "Approved by
 * you — applied." would be two records of one decision.
 */
export interface ApprovalOutcome {
  /** True only for an approved write that did not land; drives the red line. */
  failed: boolean
  /**
   * The state glyph that leads the line, in the deployment card's language:
   * ● applied, ◐ still running, – denied or cancelled, ✕ failed. It is drawn,
   * not read: the words carry the state.
   */
  mark: OutcomeMark
  /** The sentence, up to the error code when there is one. */
  text: string
  /**
   * The envelope's code ("ISSUE_NOT_FOUND"). The card leaves it to the ErrorCard
   * below it; the status line, which does not read that card, says it.
   */
  code?: string
}

export type OutcomeMark = '●' | '◐' | '–' | '✕'

/** The fields of a tool part the outcome is read from; loose, to fit any tool. */
export interface ApprovalPartLike {
  state?: string
  approval?: { id?: string; approved?: boolean; reason?: string }
  output?: unknown
  errorText?: string
}

/** How an approved write went, once it has run; undefined until then. */
interface Result {
  failed: boolean
  mark: OutcomeMark
  /** Reads after "Approved by you —" or "…but it failed:". */
  text: string
  code?: string
  /**
   * The call threw rather than returning an envelope. No ErrorCard follows it,
   * so the line has to carry the reason itself. A typed envelope error gets an
   * ErrorCard right below the card, and the line only records that it did not land.
   */
  thrown?: boolean
}

const DEPLOYMENT_MARKS: Record<string, OutcomeMark> = {
  succeeded: '●',
  failed: '✕',
  cancelled: '–',
}

function resultOf(part: ApprovalPartLike): Result | undefined {
  if (part.state === 'output-error') {
    return {
      failed: true,
      mark: '✕',
      text: part.errorText || 'the change did not go through',
      thrown: true,
    }
  }
  if (part.state !== 'output-available') return undefined
  const output = part.output
  if (typeof output !== 'object' || output === null || !('ok' in output)) {
    return { failed: false, mark: '●', text: 'done' }
  }
  const envelope = output as {
    ok: boolean
    error?: { code: string; message?: string }
    data?: unknown
  }
  if (!envelope.ok) {
    const code = envelope.error?.code
    return {
      failed: true,
      mark: '✕',
      text: 'not applied',
      ...(code === undefined ? {} : { code }),
    }
  }

  // A deployment reaches `output-available` on its first frame and stays there
  // for the whole run, so "applied" would be premature while it is going and
  // wrong afterwards for a run that was cancelled. Its own status is the truth.
  // A cancelled run is not a failure: the user asked for it.
  const status = deploymentStatus(envelope.data)
  if (status !== undefined) {
    return {
      failed: status === 'failed',
      mark: DEPLOYMENT_MARKS[status] ?? '◐',
      text: `deployment ${status}`,
    }
  }

  return { failed: false, mark: '●', text: 'applied' }
}

/** The deployment inside a run_deployment result, if this is one. */
function deploymentStatus(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('deployment' in data)) return undefined
  const deployment = data.deployment
  if (typeof deployment !== 'object' || deployment === null || !('status' in deployment)) {
    return undefined
  }
  return typeof deployment.status === 'string' ? deployment.status : undefined
}

/**
 * The recorded decision, from the moment it is answered: "Approved by you at
 * 14:02." as soon as Approve is pressed, "Approved by you at 14:02 — applied."
 * once the write has run, or "Denied by you at 14:02: “reason”.". `at` is the
 * time the person decided, when this session saw it; without it the line
 * simply has no time. A failure has to read as one: reporting only "Approved
 * by you" would present a write that never landed as one that did. A typed
 * error is shown in full by the ErrorCard below the card, so the line there
 * stays short ("— not applied.") rather than saying it twice.
 */
export function approvalOutcome(part: ApprovalPartLike, at?: string): ApprovalOutcome | undefined {
  if (part.state === 'approval-requested') return undefined
  const approved = part.approval?.approved
  if (approved === undefined) return undefined
  const when = at === undefined ? '' : ` at ${at}`

  if (!approved) {
    const reason = part.approval?.reason
    return {
      failed: false,
      mark: '–',
      text: reason ? `Denied by you${when}: “${reason}”.` : `Denied by you${when}.`,
    }
  }
  const result = resultOf(part)
  if (result === undefined) {
    return { failed: false, mark: '◐', text: `Approved by you${when}.` }
  }
  if (result.thrown) {
    return {
      failed: true,
      mark: '✕',
      text: `Approved by you${when}, but it failed: ${result.text}`,
    }
  }
  const text = `Approved by you${when} — ${result.text}`
  return {
    failed: result.failed,
    mark: result.mark,
    ...(result.code === undefined ? { text: `${text}.` } : { text, code: result.code }),
  }
}

/**
 * The outcome as one line, code included, for a screen reader to hear: the
 * status line does not read the ErrorCard that shows the code on screen.
 */
export function approvalOutcomeLine(outcome: ApprovalOutcome): string {
  return outcome.code === undefined ? outcome.text : `${outcome.text} (${outcome.code}).`
}

/**
 * Open approval cards on a message. The SDK answers approvals against the last
 * message only, so callers pass that one.
 */
export function pendingApprovalCount(parts: readonly object[] | undefined): number {
  return (parts ?? []).filter((part) => 'state' in part && part.state === 'approval-requested')
    .length
}

/** "1 change needs" / "3 changes need": the count is the subject of the sentence. */
export function changesNeedApproval(count: number): string {
  return count === 1 ? '1 change needs your approval.' : `${count} changes need your approval.`
}

/** The fields of a tool part a pending status change is read from. */
interface StatusMovePartLike {
  type?: string
  toolName?: string
  state?: string
  input?: unknown
}

/**
 * The status changes still waiting on a card, as issue key → requested status,
 * so the board can mark the issues they would move. Only `update_issue_status`
 * targets a card already on the board; a new issue has nowhere to be marked.
 * The model may write "ds-7" or " DS-7"; the api accepts both, so the key is
 * matched the same way and stored as the board spells it. A key the board does
 * not hold has no card to mark and is left out. A later card for the same issue
 * wins, as it would if both were approved.
 */
export function pendingStatusMoves(
  parts: readonly object[] | undefined,
  issues: readonly { key: string }[],
): Map<string, unknown> {
  const moves = new Map<string, unknown>()
  for (const part of (parts ?? []) as StatusMovePartLike[]) {
    if (part.state !== 'approval-requested') continue
    const isStatusChange =
      part.type === 'tool-update_issue_status' ||
      (part.type === 'dynamic-tool' && part.toolName === 'update_issue_status')
    const input = part.input as { issueKey?: unknown; status?: unknown } | undefined
    if (!isStatusChange || typeof input?.issueKey !== 'string') continue
    const issue = findIssueByKey(issues, input.issueKey)
    if (issue !== undefined) moves.set(issue.key, input.status)
  }
  return moves
}

/**
 * The reassignments still waiting on a card, as issue key → requested assignee
 * id (null to unassign), so the board can mark the cards they would hand on.
 * Matched and keyed like the status moves, for the same reasons. An assignee
 * that is not a string or null is a malformed call with nothing to show.
 */
export function pendingAssignments(
  parts: readonly object[] | undefined,
  issues: readonly { key: string }[],
): Map<string, string | null> {
  const assignments = new Map<string, string | null>()
  for (const part of (parts ?? []) as StatusMovePartLike[]) {
    if (part.state !== 'approval-requested') continue
    const isAssignment =
      part.type === 'tool-assign_issue' ||
      (part.type === 'dynamic-tool' && part.toolName === 'assign_issue')
    const input = part.input as { issueKey?: unknown; assigneeId?: unknown } | undefined
    if (!isAssignment || typeof input?.issueKey !== 'string') continue
    const assigneeId = input.assigneeId
    if (typeof assigneeId !== 'string' && assigneeId !== null) continue
    const issue = findIssueByKey(issues, input.issueKey)
    if (issue !== undefined) assignments.set(issue.key, assigneeId)
  }
  return assignments
}

/** "5 changes to review · 23 pts"; the points are left off when none are known. */
export function changesToReview(count: number, points: number): string {
  const changes = count === 1 ? '1 change to review' : `${count} changes to review`
  if (points <= 0) return changes
  return `${changes} · ${points} ${points === 1 ? 'pt' : 'pts'}`
}

/** The fields of a gated part its settled state is read from. */
interface GatedPartLike {
  toolCallId?: string
  state?: string
  approval?: unknown
}

/**
 * Each gated call on a message and its state, as one string ("[[id,state],…]").
 * A watcher on it fires only when a state changes: a Map built afresh on every
 * streamed chunk is a new value each time, so the watcher ran for every token.
 */
export function approvalStateSignature(parts: readonly object[] | undefined): string {
  const pairs: [string, string][] = []
  for (const part of (parts ?? []) as GatedPartLike[]) {
    if (part.approval !== undefined && part.toolCallId !== undefined && part.state) {
      pairs.push([part.toolCallId, part.state])
    }
  }
  return JSON.stringify(pairs)
}

/** The signature back as call id → state, in transcript order. */
export function parseApprovalStates(signature: string): Map<string, string> {
  return new Map(JSON.parse(signature) as [string, string][])
}

/** An approved write that has run, either way; its outcome line is now final. */
export function isSettledApproval(part: { state?: string; approval?: unknown }): boolean {
  return (
    part.approval !== undefined &&
    (part.state === 'output-available' || part.state === 'output-error')
  )
}

/**
 * The board writes one press of "Approve all" may answer. Release notes and
 * deployments are left out on purpose: a draft goes out under a version and a
 * deploy ships one, so each keeps a decision of its own.
 */
const BATCH_APPROVABLE_TOOLS: readonly string[] = [
  'update_issue_status',
  'create_issue',
  'assign_issue',
]

/** The fields of a pending part that "Approve all" reads. */
interface BatchPartLike {
  type?: string
  toolName?: string
  toolCallId?: string
  state?: string
  input?: unknown
  approval?: { id?: string }
}

/** A line in pieces, identifiers apart, as the error copy is (DESIGN.md, the Readout Rule). */
export type CopyPart = string | { id: string }

/** One card "Approve all" would answer. */
export interface BatchApproval {
  toolCallId: string
  approvalId: string
  /** The issue's status as the board has it now, for the card's from → to record. */
  from?: IssueStatus
  /** For an assignment: who holds the issue now (null for nobody), for the same record. */
  fromAssignee?: string | null
}

export interface ApproveAllPlan {
  /** The open board writes it answers, in transcript order. */
  approvals: BatchApproval[]
  /** Each open card it leaves for its own decision, named the way the card names it. */
  excluded: CopyPart[][]
  /** Some card in this round was already answered, so the rest are what remains. */
  remaining: boolean
}

function toolNameOf(part: BatchPartLike): string | undefined {
  if (part.type === 'dynamic-tool') return part.toolName
  return part.type?.startsWith('tool-') ? part.type.slice('tool-'.length) : undefined
}

function stringField(input: unknown, name: string): string | undefined {
  if (typeof input !== 'object' || input === null || !(name in input)) return undefined
  const value = (input as Record<string, unknown>)[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** How the header names a card it leaves alone: "DS-42", "deploying v1.5.0 to staging". */
function excludedLabel(tool: string | undefined, input: unknown): CopyPart[] {
  const key = stringField(input, 'issueKey')
  const version = stringField(input, 'version')
  if ((tool === 'update_issue_status' || tool === 'assign_issue') && key !== undefined) {
    return [{ id: key }]
  }
  if (tool === 'run_deployment' && version !== undefined) {
    const environment = stringField(input, 'environment')
    return environment === undefined
      ? ['deploying ', { id: version }]
      : ['deploying ', { id: version }, ' to ', { id: environment }]
  }
  if (tool === 'create_release_notes' && version !== undefined) {
    return ['saving the ', { id: version }, ' release notes']
  }
  return ['one other change']
}

/** The board's issue as "Approve all" reads it; `assigneeId` only matters to an assignment. */
interface BatchIssueLike {
  key: string
  status: IssueStatus
  assigneeId?: string | null
}

/**
 * Whether an assignment can land: the issue is on the board, the person is on
 * the roster (or it unassigns), and it changes who holds the issue. The api
 * refuses the other two, so approving them along with the rest could only fail.
 */
function assignmentLands(
  input: unknown,
  issue: BatchIssueLike | undefined,
  users: readonly { id: string }[],
): boolean {
  if (issue === undefined || typeof input !== 'object' || input === null) return false
  const assigneeId = (input as { assigneeId?: unknown }).assigneeId
  if (typeof assigneeId !== 'string' && assigneeId !== null) return false
  return isKnownAssignee(users, assigneeId) && assigneeId !== (issue.assigneeId ?? null)
}

/**
 * What "Approve all" would answer on a message, and what it leaves. Only board
 * writes that can land qualify: a status change for a key the board does not
 * hold is the S-E case, where the card makes Deny the default, so it is left
 * for the person to read rather than approved along with the rest. An
 * assignment is left the same way when its issue or person is not on the
 * board, or it would hand the issue to whoever already has it.
 */
export function approveAllPlan(
  parts: readonly object[] | undefined,
  issues: readonly BatchIssueLike[],
  users: readonly { id: string }[] = [],
): ApproveAllPlan {
  const plan: ApproveAllPlan = { approvals: [], excluded: [], remaining: false }
  for (const part of (parts ?? []) as BatchPartLike[]) {
    if (part.approval === undefined) continue
    if (part.state !== 'approval-requested') {
      // Answered this round, its write not yet run. A card that already ran
      // (output-*) belongs to an earlier round on the same message: the
      // continuation appends there, so a fresh batch is not "the rest" of it.
      if (part.state === 'approval-responded') plan.remaining = true
      continue
    }
    const tool = toolNameOf(part)
    const key = stringField(part.input, 'issueKey')
    const issue = key === undefined ? undefined : findIssueByKey(issues, key)
    const lands =
      tool === 'assign_issue'
        ? assignmentLands(part.input, issue, users)
        : tool !== 'update_issue_status' || issue !== undefined
    const approvalId = part.approval.id
    if (
      tool !== undefined &&
      BATCH_APPROVABLE_TOOLS.includes(tool) &&
      lands &&
      approvalId !== undefined &&
      part.toolCallId !== undefined
    ) {
      plan.approvals.push({
        toolCallId: part.toolCallId,
        approvalId,
        ...(issue === undefined ? {} : { from: issue.status }),
        ...(tool === 'assign_issue' && issue !== undefined
          ? { fromAssignee: issue.assigneeId ?? null }
          : {}),
      })
    } else {
      plan.excluded.push(excludedLabel(tool, part.input))
    }
  }
  return plan
}

/** A single press only earns its place over two or more cards. */
export const APPROVE_ALL_MIN = 2

/** "Approve all 5", or "Approve remaining 3" once some were answered one by one. */
export function approveAllLabel(count: number, remaining: boolean): string {
  return remaining ? `Approve remaining ${count}` : `Approve all ${count}`
}

/**
 * "DS-42 needs its own decision." or "DS-42 and deploying v1.5.0 need their
 * own decisions.", for the cards "Approve all" leaves, so its count is never a
 * surprise.
 */
export function needOwnDecision(labels: readonly CopyPart[][]): CopyPart[] {
  if (labels.length === 0) return []
  const joined: CopyPart[] = []
  labels.forEach((label, index) => {
    if (index > 0) joined.push(index === labels.length - 1 ? ' and ' : ', ')
    joined.push(...label)
  })
  const [first, ...rest] = joined
  const lead =
    typeof first === 'string' ? `${first.charAt(0).toUpperCase()}${first.slice(1)}` : first
  const verb = labels.length === 1 ? ' needs its own decision.' : ' need their own decisions.'
  return [lead as CopyPart, ...rest, verb]
}

/** What the status line says once one press has answered several cards. */
export function approvedTogether(count: number, at?: string): string {
  const when = at === undefined ? '' : ` at ${at}`
  return `${count} changes approved by you${when}.`
}

/** The same press, once its writes have run: one line for every card that applied. */
export function appliedTogether(count: number, at?: string): string {
  const when = at === undefined ? '' : ` at ${at}`
  return `${count} changes approved by you${when} — applied.`
}
