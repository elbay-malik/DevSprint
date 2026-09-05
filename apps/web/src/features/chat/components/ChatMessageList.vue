<script setup lang="ts">
import { computed } from 'vue'
import { isToolUIPart } from 'ai'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import ToolCallChip from './ToolCallChip.vue'

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
      <!-- 'step-start' and any other part types are intentionally not rendered -->
      <template v-for="(part, index) in message.parts" :key="index">
        <span v-if="part.type === 'text'" class="whitespace-pre-wrap">{{ part.text }}</span>
        <ToolCallChip v-else-if="isToolUIPart(part)" :part="part" :live="isLive(message.id)" />
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
