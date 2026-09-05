<script setup lang="ts">
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import ChatInput from './ChatInput.vue'
import ChatMessageList from './ChatMessageList.vue'
</script>

<template>
  <section data-testid="chat-pane" class="flex min-h-0 flex-col border-t lg:border-t-0">
    <header class="px-4 py-3 lg:px-6">
      <h2 class="text-sm font-semibold">Copilot</h2>
      <p class="text-muted-foreground text-xs">
        Answers are grounded in the workspace via read-only tools. Writes arrive with approvals in
        Phase 5.
      </p>
    </header>
    <Separator />
    <ScrollArea class="min-h-0 flex-1">
      <ChatMessageList />
    </ScrollArea>
    <Separator />
    <ChatInput />
  </section>
</template>
