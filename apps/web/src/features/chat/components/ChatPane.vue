<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import ChatInput from './ChatInput.vue'
import ChatMessageList from './ChatMessageList.vue'
import { useDevSprintChat } from '../composables/useDevSprintChat'

/**
 * Auto-scroll, as wireframes.md §6 has described it all along: the pane follows
 * new tokens, and scrolling up releases it so reading back through a transcript
 * is not fought by every delta that arrives.
 *
 * It was documented as shipped behaviour and never built, which is worse than
 * it sounds for a streaming chat — the answer arrives below the fold and the
 * pane simply does not move.
 *
 * "Were you at the bottom *before* this update?" is read straight from the
 * element rather than tracked with a scroll listener. A listener has to attach
 * to reka-ui's viewport, which does not exist yet when this component mounts —
 * so it silently never attached, and the pane followed the stream even after
 * the reader had scrolled away. The watcher's default `pre` flush runs before
 * the DOM updates, which is exactly when that question has a truthful answer.
 */
const chat = useDevSprintChat()
const root = ref<HTMLElement>()

/** reka-ui renders the scrollable element inside the root, not as the root. */
function viewport(): HTMLElement | null {
  return root.value?.querySelector('[data-slot="scroll-area-viewport"]') ?? null
}

/** Within a line or so of the bottom counts as "following". */
function atBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 24
}

// The parts of the last message mutate in place as tokens arrive, so watching
// the message list deeply is what actually tracks a streaming answer; watching
// its length alone would only fire once per message.
watch(
  () => [chat.messages.length, chat.status, JSON.stringify(chat.messages.at(-1)?.parts ?? [])],
  () => {
    const element = viewport()
    // Nothing to scroll yet: a first message should land at the bottom.
    const following = element === null || atBottom(element)
    void nextTick(() => {
      const after = viewport()
      if (following && after) after.scrollTop = after.scrollHeight
    })
  },
)
</script>

<template>
  <section ref="root" data-testid="chat-pane" class="flex min-h-0 flex-col border-t lg:border-t-0">
    <header class="px-4 py-3 lg:px-6">
      <h2 class="text-sm font-semibold">Copilot</h2>
      <p data-testid="chat-subtitle" class="text-muted-foreground text-xs">
        Answers are grounded in the workspace by real tool calls. Every write asks you to approve it
        first.
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
