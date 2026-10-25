<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isToolUIPart } from 'ai'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import {
  approvalOutcome,
  approvalOutcomeLine,
  changesNeedApproval,
  changesToReview,
  pendingApprovalCount,
  pendingStatusMoves,
} from '../lib/approvals'
import ApprovalCard from './ApprovalCard.vue'
import ChatText from './ChatText.vue'
import ToolResultCard from './ToolResultCard.vue'

const chat = useDevSprintChat()
const workspace = useWorkspaceStore()
const root = ref<HTMLElement>()

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
}

/**
 * Five cards in a row are one review, not five unrelated asks, so a message
 * with two or more gets a header that counts what is still open and what it
 * weighs on the board. Each card keeps its own decision; only the first open
 * one spends the Ink (DESIGN.md, "Ink once per region").
 */
function approvalGroupOf(parts: readonly object[]): ApprovalGroup {
  const gated = (parts as (ToolPartLike & { approval?: unknown })[])
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.approval !== undefined)
  const open = gated.filter(({ part }) => part.state === 'approval-requested')
  const group: ApprovalGroup = { leadId: open[0]?.part.toolCallId }
  if (gated.length < 2 || open.length === 0) return group

  const points = [...pendingStatusMoves(parts).keys()].reduce(
    (sum, key) =>
      sum + (workspace.workspace.issues.find((issue) => issue.key === key)?.points ?? 0),
    0,
  )
  return { ...group, headerAt: gated[0]?.index, header: changesToReview(open.length, points) }
}

const approvalGroups = computed(
  () => new Map(chat.messages.map((message) => [message.id, approvalGroupOf(message.parts)])),
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

function focusComposer(): void {
  const pane = root.value?.closest('[data-testid="chat-pane"]')
  pane?.querySelector<HTMLElement>('[data-chat-composer]')?.focus()
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
    const pending = pendingApprovalCount(last.parts)
    if (pending === 0) {
      announcement.value = 'Copilot replied.'
      return
    }
    announcement.value = changesNeedApproval(pending)
    if (mayMoveFocus()) focusTarget(pendingCallIds()[0])?.focus()
  },
  { flush: 'post' },
)

/** Each gated call on the last message and its state, to spot a decision. */
function approvalStates(): Map<string, string> {
  const states = new Map<string, string>()
  for (const part of (chat.messages.at(-1)?.parts ?? []) as (ToolPartLike & {
    approval?: unknown
  })[]) {
    if (part.approval !== undefined && part.toolCallId !== undefined && part.state) {
      states.set(part.toolCallId, part.state)
    }
  }
  return states
}

watch(
  approvalStates,
  (states, previous) => {
    const decidedId = [...states.keys()].find(
      (id) => previous.get(id) === 'approval-requested' && states.get(id) !== 'approval-requested',
    )
    if (decidedId === undefined) return

    const parts = chat.messages.at(-1)?.parts ?? []
    const part = (parts as ToolPartLike[]).find((candidate) => candidate.toolCallId === decidedId)
    const outcome = part ? approvalOutcome(part) : undefined
    const said = outcome ? approvalOutcomeLine(outcome) : ''
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
    focusTarget(after ?? pending[0])?.focus()
  },
  { flush: 'post' },
)
</script>

<template>
  <div ref="root" class="flex flex-col gap-3 p-4 lg:px-6">
    <p v-if="chat.messages.length === 0" class="text-muted-foreground text-sm text-pretty">
      Ask how the sprint is going, or tell the copilot what to change. Try “How many open issues are
      in the current sprint?”
    </p>
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
            ? 'bg-primary text-primary-foreground self-end'
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
            <p
              v-if="approvalGroups.get(message.id)?.headerAt === index"
              data-testid="approval-group-header"
              class="text-xs font-medium tabular-nums"
            >
              {{ approvalGroups.get(message.id)?.header }}
            </p>
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
