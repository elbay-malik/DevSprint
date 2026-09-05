/**
 * Approval integrity for the gated write tools (ADR-0003).
 *
 * The message history that carries an approval is client-controlled, so two
 * separate defences are needed and the SDK only provides one of them.
 *
 * FORGERY — handled by the SDK. Setting `experimental_toolApprovalSecret` makes
 * it sign every approval request (HMAC-SHA256 over the approval id, tool call
 * id, tool name and a digest of the input) and re-verify the signature before
 * executing. Verified against ai@6.0.277: with no secret configured, a wholly
 * fabricated approval executes the write.
 *
 * REPLAY — not handled by the SDK. The signed payload carries no nonce and no
 * expiry, so one captured approval verifies forever; replaying a single valid
 * approval was measured executing the same write three times. ADR-0003 requires
 * that a forged *or replayed* approval never suffice, so the ledger below burns
 * each approval id the first time it is acted on.
 */
import type { UIMessage } from 'ai'

/** Env var name for the production signing secret. */
export const APPROVAL_SECRET_VAR = 'TOOL_APPROVAL_SECRET'

let ephemeralSecret: string | undefined
let warnedEphemeral = false

/**
 * The signing secret. A configured secret is stable across isolates, which is
 * what production needs. Without one we mint a random per-isolate secret rather
 * than running unsigned: keyless local dev and CI keep working, and forged
 * approvals are still rejected. The cost is that approvals do not survive a
 * restart or cross isolates, which is why deployments must set the var.
 */
export function resolveApprovalSecret(configured: string | undefined): string {
  const trimmed = configured?.trim()
  if (trimmed !== undefined && trimmed.length > 0) return trimmed

  if (!warnedEphemeral) {
    warnedEphemeral = true
    console.warn(
      `${APPROVAL_SECRET_VAR} is not set — signing approvals with a random per-isolate secret. ` +
        'Approvals will not survive a restart. Set the secret before deploying.',
    )
  }
  ephemeralSecret ??= crypto.randomUUID()
  return ephemeralSecret
}

/**
 * Approval ids that have already been acted on.
 *
 * In-memory and therefore per-isolate: on Workers this bounds replay within an
 * isolate rather than globally. D1 (Phase 9) is where this should live to make
 * the guarantee real; the limitation is called out in apps/api/README.md rather
 * than left to be discovered.
 */
const spentApprovals = new Set<string>()

/** Test seam — the ledger is module state, so suites must be able to reset it. */
export function resetApprovalLedger(): void {
  spentApprovals.clear()
  ephemeralSecret = undefined
}

interface RespondedApproval {
  id: string
  approved?: boolean
  reason?: string
}

/**
 * Approvals the client is asking us to act on *now*: answered, but whose tool
 * call has not produced a result yet.
 *
 * Answered approvals stay in the transcript forever, so filtering on the part's
 * state is what separates "act on this" from "this already happened". Spending
 * the latter would refuse every later message in the conversation.
 */
function pendingApprovals(messages: UIMessage[]): RespondedApproval[] {
  const approvals: RespondedApproval[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (!('state' in part) || part.state !== 'approval-responded') continue
      const approval: unknown = part.approval
      if (typeof approval === 'object' && approval !== null && 'id' in approval) {
        const { id } = approval
        if (typeof id === 'string') approvals.push(approval as RespondedApproval)
      }
    }
  }
  return approvals
}

const REPLAY_REASON = 'This approval was already used, so it was not applied again.'

/**
 * Spends each approval once, and turns anything already spent into a denial.
 *
 * Refusing the whole request instead would be worse than it sounds: the answered
 * parts stay in the client's transcript, so once a resume failed after its
 * approvals were spent, every later message would carry them again and be
 * refused in turn — the conversation would be permanently stuck. Downgrading to
 * a denial keeps the safety property that matters (the write does not run twice)
 * while letting the user carry on and ask again.
 *
 * Mutates the parsed request copy, which is the only thing downstream reads.
 */
export function settleApprovals(messages: UIMessage[]): { replayed: number } {
  const seen = new Set<string>()
  let replayed = 0

  for (const approval of pendingApprovals(messages)) {
    // A batch repeating one id would otherwise let a single human decision
    // authorise two mutations, since neither copy is spent yet.
    if (spentApprovals.has(approval.id) || seen.has(approval.id)) {
      if (approval.approved !== false) {
        approval.approved = false
        approval.reason = REPLAY_REASON
      }
      replayed += 1
      continue
    }
    seen.add(approval.id)
    spentApprovals.add(approval.id)
  }

  return { replayed }
}
