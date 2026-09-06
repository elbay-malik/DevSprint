<script setup lang="ts">
import { computed } from 'vue'
import { isToolUIPart } from 'ai'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import ApprovalCard from './ApprovalCard.vue'
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
</script>

<template>
  <div class="flex flex-col gap-3 p-4 lg:px-6">
    <p v-if="chat.messages.length === 0" class="text-muted-foreground text-sm">
      Ask about the sprint — try “How many open issues are in the current sprint?”
    </p>
    <div
      v-for="message in chat.messages"
      :key="message.id"
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
        <span v-if="part.type === 'text'" class="whitespace-pre-wrap">{{ part.text }}</span>
        <ApprovalCard v-else-if="isToolUIPart(part) && isApprovalPart(part)" :part="part" />
        <ToolResultCard v-else-if="isToolUIPart(part)" :part="part" :live="isLive(message.id)" />
      </template>
    </div>
    <div
      v-if="chat.status === 'submitted'"
      data-testid="thinking-indicator"
      class="flex gap-1 self-start px-1"
    >
      <span class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full" />
      <span
        class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full [animation-delay:150ms]"
      />
      <span
        class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full [animation-delay:300ms]"
      />
    </div>
  </div>
</template>
