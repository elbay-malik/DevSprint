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
 * that a forged *or replayed* approval never suffice, so every approval id is
 * spent the first time it is acted on — via `workspace.spendApprovals`, the
 * one piece of durable, serialising state this Worker has (ADR-0014).
 */
import type { UIMessage } from 'ai'
import type { WorkspaceApi } from '@devsprint/shared/tools'

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
 * Test seam for the module state above — the warn-once latch and the
 * ephemeral secret. Leaving either set makes a test that asserts on the
 * warning, or on the secret's value, depend on which test ran first. The
 * ledger itself has no module state left to reset: it lives in the workspace
 * now (ADR-0014), and each test builds its own.
 */
export function resetApprovalSigningState(): void {
  ephemeralSecret = undefined
  warnedEphemeral = false
}

interface RespondedApproval {
  id: string
  approved?: boolean
  reason?: string
}

/**
 * A real id is a `crypto.randomUUID()` (36 characters), minted by the SDK
 * before this code ever sees it. This is not that check — signature
 * verification, which does reject a fabricated id, runs later, inside the
 * agent loop. `pendingApprovals` runs first and touches the ledger before
 * anything has verified the id is real, so a client-supplied id has to be
 * bounded here regardless: without it, one oversized string (or many) could
 * make `spendApprovals` try to persist more than a Durable Object storage
 * value allows, failing every later chat that touches the ledger until the
 * next reset — a denial of service that needs no valid signature at all.
 */
const MAX_APPROVAL_ID_LENGTH = 64

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
        if (typeof id === 'string' && id.length > 0 && id.length <= MAX_APPROVAL_ID_LENGTH) {
          approvals.push(approval as RespondedApproval)
        }
      }
    }
  }
  return approvals
}

const REPLAY_REASON = 'This approval was already used, so it was not applied again.'

/** Turns an approval into a denial, unless it already was one. */
function denyReplay(approval: RespondedApproval): void {
  if (approval.approved !== false) {
    approval.approved = false
    approval.reason = REPLAY_REASON
  }
}

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
 *
 * Two passes, deliberately. A batch repeating one id is caught locally first —
 * that is purely about this request, so it costs nothing to check before
 * asking anyone else. What crosses the workspace boundary is only the ids that
 * pass that check, once each: `spendApprovals` is where a *previous* request's
 * approval is actually caught, and it is the one call that has to be durable.
 */
export async function settleApprovals(
  messages: UIMessage[],
  workspace: Pick<WorkspaceApi, 'spendApprovals'>,
): Promise<{ replayed: number }> {
  const byId = new Map<string, RespondedApproval[]>()
  const toSpend: string[] = []

  for (const approval of pendingApprovals(messages)) {
    const duplicates = byId.get(approval.id)
    if (duplicates) {
      duplicates.push(approval)
      continue
    }
    byId.set(approval.id, [approval])
    toSpend.push(approval.id)
  }

  const alreadySpent = new Set(toSpend.length > 0 ? await workspace.spendApprovals(toSpend) : [])
  let replayed = 0

  for (const [id, [first, ...duplicates]] of byId) {
    if (alreadySpent.has(id)) {
      denyReplay(first!)
      replayed += 1
    }
    for (const duplicate of duplicates) {
      denyReplay(duplicate)
      replayed += 1
    }
  }

  return { replayed }
}
