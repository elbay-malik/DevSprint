<script setup lang="ts">
import { computed } from 'vue'
import { isToolUIPart } from 'ai'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import ApprovalCard from './ApprovalCard.vue'
import ChatText from './ChatText.vue'
import ToolResultCard from './ToolResultCard.vue'

const chat = useDevSprintChat()

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
</script>

<template>
  <div class="flex flex-col gap-3 p-4 lg:px-6">
    <p v-if="chat.messages.length === 0" class="text-muted-foreground text-sm">
      Ask how the sprint is going, or tell the copilot what to change. Try “How many open issues are
      in the current sprint?”
    </p>
    <div
      v-for="message in chat.messages"
      :key="message.id"
      data-testid="chat-message"
      :data-role="message.role"
      class="flex max-w-[85%] flex-col gap-2 rounded-lg px-3 py-2 text-sm"
      :class="
        message.role === 'user'
          ? 'bg-primary text-primary-foreground self-end'
          : 'bg-muted self-start'
      "
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
          <ApprovalCard v-if="isApprovalPart(part)" :part="part" />
          <ToolResultCard
            v-if="!isApprovalPart(part) || isRunningDeployment(part) || isFailedWrite(part)"
            :part="part"
            :live="isLive(message.id)"
          />
        </template>
      </template>
    </div>
    <div
      v-if="chat.status === 'submitted'"
      data-testid="thinking-indicator"
      class="flex gap-1 self-start px-1"
    >
      <!-- The dots are for sighted readers; the status line is what gets announced. -->
      <span role="status" class="sr-only">The copilot is working on your request…</span>
      <span
        aria-hidden="true"
        class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full"
      />
      <span
        aria-hidden="true"
        class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full [animation-delay:150ms]"
      />
      <span
        aria-hidden="true"
        class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full [animation-delay:300ms]"
      />
    </div>
  </div>
</template>
