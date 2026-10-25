<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isToolUIPart } from 'ai'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { MCP_ENDPOINT } from '@/lib/api'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import {
  APPROVE_ALL_MIN,
  approvalOutcome,
  approvalOutcomeLine,
  approvalStateSignature,
  approveAllLabel,
  approveAllPlan,
  approvedTogether,
  changesNeedApproval,
  changesToReview,
  isSettledApproval,
  parseApprovalStates,
  pendingApprovalCount,
  needOwnDecision,
  pendingStatusMoves,
  type ApprovalPartLike,
  type BatchApproval,
  type CopyPart,
} from '../lib/approvals'
import {
  decisionTimeOf,
  formatDecisionTime,
  lastUndo,
  recordDecision,
} from '../lib/approval-records'
import { SUGGESTIONS } from '../lib/suggestions'
import { findIssueByKey } from '@/features/workspace/lib/issue-key'
import ApprovalCard from './ApprovalCard.vue'
import ChatText from './ChatText.vue'
import ToolResultCard from './ToolResultCard.vue'

const chat = useDevSprintChat()
const workspace = useWorkspaceStore()
const root = ref<HTMLElement>()
/** Before it scrolls a card into view, so the pane stops following the bottom. */
const emit = defineEmits<{ reveal: [] }>()

const busy = computed(() => chat.status === 'submitted' || chat.status === 'streaming')

/**
 * Only the last message can be the one streaming, so only its chips may claim
 * to be running. A global flag would resurrect an earlier turn's aborted call
 * as "running…" for the whole of every later turn.
 */
function isLive(messageId: string): boolean {
  return busy.value && chat.messages.at(-1)?.id === messageId
}

/**
 * A gated call is owned by the ApprovalCard for its whole life — asking,
 * answered, executed or denied — so the decision and its reason stay on screen
 * as the audit record (docs/wireframes.md §3) instead of collapsing into a chip
 * the moment the write runs. The presence of an `approval` is what marks the
 * call as gated; ungated reads never have one.
 */
function isApprovalPart(part: { approval?: unknown }): boolean {
  return part.approval !== undefined
}

/** How a message's approval cards read as a set. */
interface ApprovalGroup {
  /** The card that holds the message's one Ink button: the first undecided one. */
  leadId?: string
  /** Where the group's one-line header goes, when the message asks for two or more. */
  headerAt?: number
  /** "5 changes to review · 23 pts". */
  header?: string
  /** The open board writes one press would answer, when there are enough to offer it. */
  approveAll?: { approvals: BatchApproval[]; label: string; note: CopyPart[] }
}

/**
 * Five cards in a row are one review, not five unrelated asks, so a message
 * with two or more gets a header that counts what is still open and what it
 * weighs on the board. Each card keeps its own decision; only the first open
 * one spends the Ink (DESIGN.md, "Ink once per region").
 *
 * When two or more of the open cards are board writes that can land, the
 * header also offers "Approve all N", and that becomes the region's one Ink:
 * no card's Approve is filled beside it. Its count is exactly what it answers,
 * and whatever it leaves (a deploy, release notes, a key the board does not
 * hold) is named under it. Only the last message gets it, because the SDK
 * answers approvals against the last message only.
 */
function approvalGroupOf(parts: readonly object[], last: boolean): ApprovalGroup {
  const gated = (parts as (ToolPartLike & { approval?: unknown })[])
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.approval !== undefined)
  const open = gated.filter(({ part }) => part.state === 'approval-requested')
  const group: ApprovalGroup = { leadId: open[0]?.part.toolCallId }
  if (gated.length < 2 || open.length === 0) return group

  const issues = workspace.workspace.issues
  const points = [...pendingStatusMoves(parts, issues).keys()].reduce(
    (sum, key) => sum + (findIssueByKey(issues, key)?.points ?? 0),
    0,
  )
  const header = {
    ...group,
    headerAt: gated[0]?.index,
    header: changesToReview(open.length, points),
  }
  const plan = approveAllPlan(parts, issues)
  if (!last || plan.approvals.length < APPROVE_ALL_MIN) return header
  return {
    ...header,
    leadId: undefined,
    approveAll: {
      approvals: plan.approvals,
      label: approveAllLabel(plan.approvals.length, plan.remaining),
      note: needOwnDecision(plan.excluded),
    },
  }
}

const approvalGroups = computed(
  () =>
    new Map(
      chat.messages.map((message, index, all) => [
        message.id,
        approvalGroupOf(message.parts, index === all.length - 1),
      ]),
    ),
)

/**
 * A deployment is gated *and* long-running, so it needs both: the approval card
 * stays as the record of who allowed it, and the progress card shows the run it
 * authorised (docs/tool-inventory.md — ApprovalCard → DeploymentProgressCard).
 */
function isRunningDeployment(part: { type?: string; state?: string }): boolean {
  return part.type === 'tool-run_deployment' && part.state === 'output-available'
}

/**
 * An approved write that came back as a typed error gets the ErrorCard as well
 * (scenario S-E): the approval card records the decision, but a one-line note
 * on it is easy to read past as "approved, so done", and the error is what the
 * agent's next move answers to.
 */
function isFailedWrite(part: { state?: string; output?: unknown }): boolean {
  if (part.state !== 'output-available') return false
  const output = part.output
  return typeof output === 'object' && output !== null && 'ok' in output && output.ok === false
}

/**
 * What the polite status region says, driven through the whole turn (WCAG
 * 4.1.3). The streamed text is never live itself — token-by-token updates would
 * flood a screen reader — so this one line reports the turn's milestones: it
 * started, it finished, it is waiting on approvals, a decision was recorded.
 */
const announcement = ref('')
const WORKING = 'The copilot is working on your request…'

/**
 * The last decision of a step, kept for the request it triggers. Answering the
 * last card resends at once, and a polite region that changes twice in a row
 * tends to be read only for the second change, so "working" carries it along.
 */
let decisionToCarry = ''

/**
 * Gated calls that had already run when this turn started. An approved write
 * runs on the request its approval triggers, so the card's final line ("… — not
 * applied (ISSUE_NOT_FOUND).") arrives mid-turn, after "Approved by you." was
 * said. Whatever settles during the turn is said when it ends, or a failure
 * would be silent.
 */
let settledBefore = settledCallIds()

function settledCallIds(): Set<string> {
  const ids = new Set<string>()
  for (const message of chat.messages) {
    for (const part of message.parts as (ToolPartLike & { approval?: unknown })[]) {
      if (part.toolCallId !== undefined && isSettledApproval(part)) ids.add(part.toolCallId)
    }
  }
  return ids
}

/** Outcome lines of the writes that ran this turn, failures first. */
function settledThisTurn(parts: readonly object[]): string {
  const outcomes = (parts as (ToolPartLike & ApprovalPartLike)[])
    .filter(
      (part) =>
        part.toolCallId !== undefined &&
        isSettledApproval(part) &&
        !settledBefore.has(part.toolCallId),
    )
    .map((part) => approvalOutcome(part, decisionTimeOf(part)))
    .filter((outcome) => outcome !== undefined)
  return [...outcomes.filter((o) => o.failed), ...outcomes.filter((o) => !o.failed)]
    .map(approvalOutcomeLine)
    .join(' ')
}

/**
 * The calls one "Approve all" press answered and not yet seen decided, with
 * what the status line says once they all are. The SDK takes each answer as a
 * job of its own, so the cards turn over across several renders, and saying
 * each one, and moving focus card by card, would be four announcements and
 * four jumps for one press.
 */
let batch: { ids: Set<string>; said: string } | undefined

/**
 * Answers every open board write in the group, one approval at a time, so each
 * card records and resumes exactly as if it had been pressed: its own decision
 * time and "from", its own record line, its own single-use approval id.
 */
function approveAll(messageId: string): void {
  if (chat.messages.at(-1)?.id !== messageId) return
  const approvals = approvalGroups.value.get(messageId)?.approveAll?.approvals ?? []
  if (approvals.length === 0) return
  const decidedAt = new Date()
  batch = {
    ids: new Set(approvals.map((approval) => approval.toolCallId)),
    said: approvedTogether(approvals.length, formatDecisionTime(decidedAt)),
  }
  for (const { approvalId, from } of approvals) {
    recordDecision(approvalId, { decidedAt, ...(from === undefined ? {} : { from }) })
    void chat.addToolApprovalResponse({ id: approvalId, approved: true })
  }
}

/**
 * Focus follows the decisions (WCAG 2.4.3), but only for someone already in the
 * chat. Focus on <body> means it was just dropped — a removed Approve button —
 * and a user working on the board is left where they are.
 */
function mayMoveFocus(): boolean {
  const active = document.activeElement
  if (active === null || active === document.body) return true
  const pane = root.value?.closest('[data-testid="chat-pane"]') ?? root.value
  return pane?.contains(active) ?? false
}

function focusTarget(callId: string | undefined): HTMLElement | null {
  if (callId === undefined) return null
  return (
    root.value?.querySelector<HTMLElement>(
      `[data-call-id="${CSS.escape(callId)}"] [data-approval-focus]`,
    ) ?? null
  )
}

/**
 * Focus a decision without letting the browser scroll just the button row into
 * view: that hides the card's own headline, and on the first card the group
 * header above it. The card (or the header) is brought to the top instead, and
 * the decision row only nudged into view if the card is taller than the pane.
 */
function focusDecision(callId: string | undefined, withHeader = false): void {
  const target = focusTarget(callId)
  if (target === null) return
  target.focus({ preventScroll: true })
  // Without this the pane's follow-the-bottom pins the view straight back down.
  emit('reveal')
  const card = target.closest<HTMLElement>('[data-call-id]')
  const header = withHeader ? card?.previousElementSibling : null
  const top = header?.matches('[data-testid="approval-group-header"]') ? header : card
  // Optional: jsdom has no scrollIntoView.
  top?.scrollIntoView?.({ block: 'start' })
  target.scrollIntoView?.({ block: 'nearest' })
}

function focusComposer(): void {
  const pane = root.value?.closest('[data-testid="chat-pane"]')
  pane?.querySelector<HTMLElement>('[data-chat-composer]')?.focus()
}

/**
 * A suggestion sends its scenario's prompt as written. Focus goes to the
 * composer first, because the chip is about to unmount and would otherwise drop
 * it to <body>.
 */
function suggest(prompt: string): void {
  if (busy.value) return
  focusComposer()
  void chat.sendMessage({ text: prompt })
}

/** "Copied" for a moment after the MCP address reaches the clipboard. */
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(copiedTimer))

async function copyMcpEndpoint(): Promise<void> {
  try {
    // Absent outside a secure context, so the call itself can throw.
    await navigator.clipboard.writeText(MCP_ENDPOINT)
  } catch {
    toast.error("Couldn't copy the address", { description: 'Select it and copy it by hand.' })
    return
  }
  copied.value = true
  announcement.value = 'MCP address copied.'
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 2000)
}

type ToolPartLike = { toolCallId?: string; state?: string }

/** Open cards on the last message, in transcript order. */
function pendingCallIds(): string[] {
  return ((chat.messages.at(-1)?.parts ?? []) as ToolPartLike[])
    .filter((part) => part.state === 'approval-requested' && part.toolCallId !== undefined)
    .map((part) => part.toolCallId as string)
}

watch(
  () => chat.status,
  (status, previous) => {
    if (status === 'submitted') {
      announcement.value = decisionToCarry ? `${decisionToCarry} ${WORKING}` : WORKING
      decisionToCarry = ''
      settledBefore = settledCallIds()
      return
    }
    // The composer's toast reports a failed turn; "replied" would be untrue.
    if (status === 'error') {
      announcement.value = ''
      return
    }
    if (status !== 'ready' || (previous !== 'submitted' && previous !== 'streaming')) return

    const last = chat.messages.at(-1)
    // Stopped before a word came back: there is no reply to report.
    if (last?.role !== 'assistant') {
      announcement.value = ''
      return
    }
    // One update for the whole turn: what ran, then what the turn ended on.
    const ran = settledThisTurn(last.parts)
    const said = (line: string) => (ran ? `${ran} ${line}` : line)
    const pending = pendingApprovalCount(last.parts)
    if (pending === 0) {
      announcement.value = said('Copilot replied.')
      return
    }
    announcement.value = said(changesNeedApproval(pending))
    if (mayMoveFocus()) focusDecision(pendingCallIds()[0], true)
  },
  { flush: 'post' },
)

/**
 * Each gated call on the last message and its state, to spot a decision. The
 * getter returns a string, so streamed chunks that change no state do not run
 * the callback.
 */
watch(
  () => approvalStateSignature(chat.messages.at(-1)?.parts),
  (signature, previousSignature) => {
    const states = parseApprovalStates(signature)
    const previous = parseApprovalStates(previousSignature)
    const decided = [...states.keys()].filter(
      (id) => previous.get(id) === 'approval-requested' && states.get(id) !== 'approval-requested',
    )
    const decidedId = decided.at(-1)
    if (decidedId === undefined) return

    let said: string
    if (batch !== undefined && decided.some((id) => batch?.ids.has(id))) {
      // Wait for the whole press to land, then say it once.
      for (const id of batch.ids) if (states.get(id) !== 'approval-requested') batch.ids.delete(id)
      if (batch.ids.size > 0) return
      said = batch.said
      batch = undefined
    } else {
      const parts = chat.messages.at(-1)?.parts ?? []
      const part = (parts as (ToolPartLike & ApprovalPartLike)[]).find(
        (candidate) => candidate.toolCallId === decidedId,
      )
      const outcome = part ? approvalOutcome(part, decisionTimeOf(part)) : undefined
      said = outcome ? approvalOutcomeLine(outcome) : ''
    }
    const pending = pendingCallIds()

    announcement.value =
      pending.length > 0 ? `${said} ${changesNeedApproval(pending.length)}` : said
    decisionToCarry = pending.length > 0 ? '' : said

    if (!mayMoveFocus()) return
    if (pending.length === 0) {
      focusComposer()
      return
    }
    // The next open card after the one just answered, wrapping to the first.
    const order = [...states.keys()]
    const after = order.slice(order.indexOf(decidedId) + 1).find((id) => pending.includes(id))
    focusDecision(after ?? pending[0])
  },
  { flush: 'post' },
)

/** An Undo on a card is said here too, so every record line reaches the status line. */
watch(lastUndo, (undo) => {
  if (undo !== undefined) announcement.value = undo.line
})
</script>

<template>
  <div ref="root" class="flex flex-col gap-3 p-4 lg:px-6">
    <!-- First run: what to ask, then how the board works. Gone with the first
         message, so it never competes with a conversation. -->
    <div v-if="chat.messages.length === 0" data-testid="chat-empty" class="flex flex-col gap-3">
      <p class="text-muted-foreground text-sm text-pretty">
        Ask how the sprint is going, or tell the copilot what to change.
      </p>
      <!-- The chat scenarios' prompts, verbatim; the title shows what is sent. -->
      <div
        role="group"
        aria-label="Suggested requests"
        data-testid="chat-suggestions"
        class="flex flex-wrap gap-2"
      >
        <Button
          v-for="suggestion in SUGGESTIONS"
          :key="suggestion.scenario"
          type="button"
          variant="outline"
          size="sm"
          data-testid="chat-suggestion"
          :data-scenario="suggestion.scenario"
          :title="suggestion.prompt"
          class="rounded-full text-xs"
          @click="suggest(suggestion.prompt)"
        >
          {{ suggestion.label }}
        </Button>
      </div>
      <div class="text-muted-foreground flex flex-col gap-1 text-xs text-pretty">
        <p>Every visitor shares this board. It resets at 00:00 UTC.</p>
        <!-- Product chrome, not model text, so ADR-0022's no-links rule is not
             in play; a copy suits an address meant for an MCP client anyway. -->
        <!-- Copy rides on the sentence, and the address gets a line of its own:
             the live address alone nearly fills the 440px column, so a Copy
             after it always wrapped onto a line by itself. -->
        <div v-if="MCP_ENDPOINT" data-testid="mcp-endpoint" class="flex flex-col">
          <p class="flex flex-wrap items-center gap-x-2">
            <span>Any MCP client can work on it too:</span>
            <!-- The name holds still; the status line says it was copied. -->
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="mcp-endpoint-copy"
              aria-label="Copy MCP address"
              @click="copyMcpEndpoint"
            >
              {{ copied ? 'Copied' : 'Copy' }}
            </Button>
          </p>
          <code class="text-foreground font-mono break-all">{{ MCP_ENDPOINT }}</code>
        </div>
      </div>
    </div>
    <!-- A log so the transcript can be navigated as one, but not a live one:
         the status line below does the announcing, once per milestone. -->
    <div v-else role="log" aria-label="Conversation" aria-live="off" class="flex flex-col gap-3">
      <!-- Each message is named for its speaker; fill and alignment alone told
           a screen reader nothing about who said what. -->
      <article
        v-for="message in chat.messages"
        :key="message.id"
        data-testid="chat-message"
        :data-role="message.role"
        :aria-label="message.role === 'user' ? 'You' : 'Copilot'"
        class="flex flex-col gap-2 rounded-lg px-3 py-2 text-sm"
        :class="[
          message.role === 'user'
            ? 'bg-bubble-user text-bubble-user-foreground self-end'
            : 'bg-muted self-start',
          // Cards need the column's width; a text-only bubble keeps the 85% that
          // tells the two speakers apart.
          message.role === 'assistant' && message.parts.some(isToolUIPart)
            ? 'w-full'
            : 'max-w-[85%]',
        ]"
      >
        <!--
          'step-start' and any other part types are intentionally not rendered.

          The key carries the part's state because the SDK mutates part objects in
          place as a call progresses. Keying on the index alone leaves the child's
          props pointing at the same object, so a card derived from `output` would
          keep showing what it computed while the call was still running.
        -->
        <template
          v-for="(part, index) in message.parts"
          :key="`${index}-${'state' in part ? part.state : part.type}`"
        >
          <!-- The assistant's text gets the safe markdown subset (ADR-0022); a
               user's own message is shown exactly as typed. -->
          <ChatText v-if="part.type === 'text' && message.role === 'assistant'" :text="part.text" />
          <span v-else-if="part.type === 'text'" class="whitespace-pre-wrap">{{ part.text }}</span>
          <!--
            One chain, deliberately. A second top-level `v-if` here would start a
            chain of its own and detach the catch-all below from the ApprovalCard,
            so every gated write would render its approval card *and* a result
            card. The two conditions inside are independent on purpose: a gated
            deployment is the one part that wants both.
          -->
          <template v-else-if="isToolUIPart(part)">
            <!-- In the bubble's text colour: Graphite on Paper Tint is under
                 4.5:1 at 12px. -->
            <div
              v-if="approvalGroups.get(message.id)?.headerAt === index"
              data-testid="approval-group-header"
              class="flex scroll-mt-3 flex-col gap-1 text-xs"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p data-testid="approval-group-count" class="font-medium tabular-nums">
                  {{ approvalGroups.get(message.id)?.header }}
                </p>
                <!-- The group's one Ink while it is shown; the cards decide in outline. -->
                <Button
                  v-if="approvalGroups.get(message.id)?.approveAll"
                  type="button"
                  size="sm"
                  data-testid="approval-approve-all"
                  :aria-label="`${approvalGroups.get(message.id)?.approveAll?.label} changes`"
                  @click="approveAll(message.id)"
                >
                  {{ approvalGroups.get(message.id)?.approveAll?.label }}
                </Button>
              </div>
              <p
                v-if="approvalGroups.get(message.id)?.approveAll?.note.length"
                data-testid="approval-group-note"
              >
                <template
                  v-for="(piece, pieceIndex) in approvalGroups.get(message.id)?.approveAll?.note"
                  :key="pieceIndex"
                >
                  <span v-if="typeof piece === 'string'">{{ piece }}</span>
                  <span v-else class="font-mono">{{ piece.id }}</span>
                </template>
              </p>
            </div>
            <ApprovalCard
              v-if="isApprovalPart(part)"
              :part="part"
              :lead="approvalGroups.get(message.id)?.leadId === part.toolCallId"
              :data-call-id="part.toolCallId"
            />
            <ToolResultCard
              v-if="!isApprovalPart(part) || isRunningDeployment(part) || isFailedWrite(part)"
              :part="part"
              :live="isLive(message.id)"
            />
          </template>
        </template>
      </article>
    </div>
    <!-- Always mounted, so a screen reader hears the text change; a live region
         that appears already filled is often not announced at all. -->
    <span role="status" data-testid="chat-status" class="sr-only">{{ announcement }}</span>
    <div
      v-if="chat.status === 'submitted'"
      data-testid="thinking-indicator"
      class="flex gap-1 self-start px-1"
    >
      <span
        aria-hidden="true"
        class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full motion-reduce:animate-none"
      />
      <span
        aria-hidden="true"
        class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full motion-reduce:animate-none [animation-delay:150ms]"
      />
      <span
        aria-hidden="true"
        class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full motion-reduce:animate-none [animation-delay:300ms]"
      />
    </div>
  </div>
</template>
