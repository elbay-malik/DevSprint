<script setup lang="ts">
import { useDevSprintChat } from '../composables/useDevSprintChat'

const chat = useDevSprintChat()
</script>

<template>
  <div class="flex flex-col gap-3 p-4 lg:px-6">
    <p v-if="chat.messages.length === 0" class="text-muted-foreground text-sm">
      No messages yet. Say hello to test the streaming echo.
    </p>
    <div
      v-for="message in chat.messages"
      :key="message.id"
      class="max-w-[85%] rounded-lg px-3 py-2 text-sm"
      :class="
        message.role === 'user'
          ? 'bg-primary text-primary-foreground self-end'
          : 'bg-muted self-start'
      "
    >
      <template v-for="(part, index) in message.parts" :key="index">
        <span v-if="part.type === 'text'" class="whitespace-pre-wrap">{{ part.text }}</span>
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
