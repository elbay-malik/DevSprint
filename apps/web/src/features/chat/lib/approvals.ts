import { findIssueByKey } from '@/features/workspace/lib/issue-key'

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
