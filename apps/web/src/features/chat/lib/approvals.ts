/**
 * What an approval card says once it is decided, as plain data, so the card's
 * outcome line and the transcript's status announcement are the same words. A
 * screen reader hearing "Approved by you." while the card reads "Approved by
 * you — applied." would be two records of one decision.
 */
export interface ApprovalOutcome {
  /** True only for an approved write that did not land; drives the red line. */
  failed: boolean
  /** The whole sentence, without the error code. */
  text: string
  /** The envelope's code ("ISSUE_NOT_FOUND"), kept as detail after the text. */
  code?: string
}

/** The fields of a tool part the outcome is read from; loose, to fit any tool. */
export interface ApprovalPartLike {
  state?: string
  approval?: { approved?: boolean; reason?: string }
  output?: unknown
  errorText?: string
}

/** How an approved write went, once it has run; undefined until then. */
interface Result {
  failed: boolean
  /** Reads after "Approved by you —" or "…but it failed:". */
  text: string
  code?: string
}

function resultOf(part: ApprovalPartLike): Result | undefined {
  if (part.state === 'output-error') {
    return { failed: true, text: part.errorText || 'the change did not go through' }
  }
  if (part.state !== 'output-available') return undefined
  const output = part.output
  if (typeof output !== 'object' || output === null || !('ok' in output)) {
    return { failed: false, text: 'done' }
  }
  const envelope = output as {
    ok: boolean
    error?: { code: string; message?: string }
    data?: unknown
  }
  if (!envelope.ok) {
    // Every envelope carries a message written to be read, so it leads; the
    // code ("ISSUE_NOT_FOUND") follows as detail for whoever is debugging.
    const { code, message } = envelope.error ?? {}
    return {
      failed: true,
      text: message !== undefined && message.length > 0 ? message : 'the change did not go through',
      ...(code === undefined ? {} : { code }),
    }
  }

  // A deployment reaches `output-available` on its first frame and stays there
  // for the whole run, so "applied" would be premature while it is going and
  // wrong afterwards for a run that was cancelled. Its own status is the truth.
  // A cancelled run is not a failure: the user asked for it.
  const status = deploymentStatus(envelope.data)
  if (status !== undefined) return { failed: status === 'failed', text: `deployment ${status}` }

  return { failed: false, text: 'applied' }
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
 * The recorded decision, from the moment it is answered: "Approved by you." as
 * soon as Approve is pressed, "Approved by you — applied." once the write has
 * run, or "Denied: “reason”.". A failure has to read as one: reporting only
 * "Approved by you" would present a write that never landed as one that did.
 */
export function approvalOutcome(part: ApprovalPartLike): ApprovalOutcome | undefined {
  if (part.state === 'approval-requested') return undefined
  const approved = part.approval?.approved
  if (approved === undefined) return undefined

  if (!approved) {
    const reason = part.approval?.reason
    return { failed: false, text: reason ? `Denied: “${reason}”.` : 'Denied.' }
  }
  const result = resultOf(part)
  if (result?.failed) {
    return {
      failed: true,
      text: `Approved by you, but it failed: ${result.text}`,
      ...(result.code === undefined ? {} : { code: result.code }),
    }
  }
  return { failed: false, text: result ? `Approved by you — ${result.text}.` : 'Approved by you.' }
}

/** The outcome as one line, code included, for a screen reader to hear. */
export function approvalOutcomeLine(outcome: ApprovalOutcome): string {
  return outcome.code === undefined ? outcome.text : `${outcome.text} (${outcome.code})`
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
 * A later card for the same issue wins, as it would if both were approved.
 */
export function pendingStatusMoves(parts: readonly object[] | undefined): Map<string, unknown> {
  const moves = new Map<string, unknown>()
  for (const part of (parts ?? []) as StatusMovePartLike[]) {
    if (part.state !== 'approval-requested') continue
    const isStatusChange =
      part.type === 'tool-update_issue_status' ||
      (part.type === 'dynamic-tool' && part.toolName === 'update_issue_status')
    const input = part.input as { issueKey?: unknown; status?: unknown } | undefined
    if (isStatusChange && typeof input?.issueKey === 'string') {
      moves.set(input.issueKey, input.status)
    }
  }
  return moves
}

/** "5 changes to review · 23 pts"; the points are left off when none are known. */
export function changesToReview(count: number, points: number): string {
  const changes = count === 1 ? '1 change to review' : `${count} changes to review`
  if (points <= 0) return changes
  return `${changes} · ${points} ${points === 1 ? 'pt' : 'pts'}`
}
