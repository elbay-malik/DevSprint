<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
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
 * Three things make this harder than "scroll on every message", and each one
 * was found by the pane failing to move:
 *
 * 1. The parts of the last message mutate in place as tokens arrive, so there
 *    is no new message to react to — the watcher has to look *into* the last
 *    message, not at the list's length.
 * 2. The scrollable element belongs to reka-ui and does not exist when this
 *    component mounts, nor reliably one tick later. Resolving it once at mount
 *    left it undefined about half the time, and a pane that never scrolled at
 *    all. It is therefore resolved lazily, on first use, and remembered then.
 * 3. The content keeps growing after the last part changes: a card laying
 *    itself out adds height once Vue has already finished with the messages.
 *    Measured, the transcript grew 682px → 822px after the final update, which
 *    left the pane stranded 184px short with nothing left to trigger it — so a
 *    ResizeObserver re-follows when that happens.
 */
const chat = useDevSprintChat()
const root = ref<HTMLElement>()
/** False once the reader scrolls away; true again when they come back down. */
const following = ref(true)
let viewport: HTMLElement | undefined
let observer: ResizeObserver | undefined
let lastTop = 0

/** Within a line or so of the bottom counts as "following". */
function atBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 24
}

/**
 * Released by scrolling *up*, not by being away from the bottom.
 *
 * The difference matters because growth moves the bottom without moving the
 * reader. Releasing on "not at the bottom" meant our own scroll-to-bottom,
 * immediately followed by a card laying itself out, delivered a scroll event
 * that already looked like the reader had wandered off — so the pane released
 * the anchor and stayed stranded for the rest of the turn. Measured at about
 * one turn in six. Growth does not change `scrollTop`; scrolling up does.
 */
function onScroll(): void {
  if (!viewport) return
  const top = viewport.scrollTop
  if (top < lastTop - 2) following.value = false
  else if (atBottom(viewport)) following.value = true
  lastTop = top
}

/**
 * The scrollable element, once reka-ui has rendered it. Wiring is attached the
 * first time it resolves rather than at mount, because at mount it is not
 * there yet.
 */
function resolveViewport(): HTMLElement | undefined {
  if (viewport) return viewport
  const found = root.value?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
  if (!found) return undefined

  viewport = found
  found.addEventListener('scroll', onScroll, { passive: true })
  const content = found.firstElementChild
  if (content) {
    observer = new ResizeObserver(() => toBottom())
    observer.observe(content)
  }
  return viewport
}

function toBottom(): void {
  const element = resolveViewport()
  if (!element || !following.value) return
  element.scrollTop = element.scrollHeight
  lastTop = element.scrollTop
}

onBeforeUnmount(() => {
  viewport?.removeEventListener('scroll', onScroll)
  observer?.disconnect()
})

watch(
  () => [chat.messages.length, chat.status, JSON.stringify(chat.messages.at(-1)?.parts ?? [])],
  () => void nextTick(toBottom),
)
</script>

<template>
  <section
    ref="root"
    data-testid="chat-pane"
    class="flex min-h-0 flex-col border-t max-lg:h-dvh lg:border-t-0"
  >
    <header class="px-4 py-3 lg:px-6">
      <h2 class="text-sm font-semibold">Copilot</h2>
      <p data-testid="chat-subtitle" class="text-muted-foreground text-xs text-pretty">
        Answers come straight from the board. Nothing changes until you approve it.
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
