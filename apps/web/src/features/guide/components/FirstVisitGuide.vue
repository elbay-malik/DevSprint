<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Button } from '@/components/ui/button'
import { closeGuide, dismissGuide, guideOpen, showOnLoad } from '../lib/guide'

/**
 * The "Try this" card a first-time visitor sees: what to do to see the one
 * thing the demo is about, an approval before any change. It does not block
 * the page: no backdrop, no focus taken, and positioned out of the layout so
 * nothing shifts. The header's Guide button opens it again.
 *
 * It closes for the visit once the composer gets focus, the moment the visitor
 * starts on step 1, so on a phone it never sits over the composer or a card's
 * Approve. It shows once the web fonts are in (showOnLoad), so its text does
 * not reflow under the visitor.
 */
const card = ref<HTMLElement>()

onMounted(() => void showOnLoad())

/** Hands focus back to the Guide button if it was in the card, never pulled from elsewhere. */
async function hide(how: () => void): Promise<void> {
  const hadFocus = card.value?.contains(document.activeElement) ?? false
  how()
  await nextTick()
  if (hadFocus) document.querySelector<HTMLElement>('[data-testid="guide-open"]')?.focus()
}

useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && guideOpen.value && !event.defaultPrevented) void hide(closeGuide)
})

useEventListener(document, 'focusin', (event: FocusEvent) => {
  if (
    guideOpen.value &&
    event.target instanceof HTMLElement &&
    event.target.closest('[data-chat-composer]')
  ) {
    closeGuide()
  }
})
</script>

<template>
  <aside
    v-if="guideOpen"
    ref="card"
    data-testid="guide"
    aria-labelledby="guide-title"
    class="bg-card text-card-foreground ring-foreground/10 absolute inset-x-2 top-full z-20 mt-2 flex flex-col gap-3 rounded-xl p-4 text-sm shadow-lg ring-1 lg:fixed lg:inset-x-auto lg:top-auto lg:bottom-4 lg:left-4 lg:mt-0 lg:w-80"
  >
    <h2 id="guide-title" class="font-semibold">Try this</h2>
    <ol class="flex list-decimal flex-col gap-2 pl-5 text-pretty">
      <li>
        Press <strong>Close out the sprint</strong> in the copilot, or ask it in your own words to
        change an issue.
      </li>
      <li>
        The copilot shows each change as a card. Nothing on the board moves until you press
        <strong>Approve</strong>. <strong>Deny</strong> drops the change, and you can add a reason.
      </li>
      <li>Watch the board update, then press <strong>Undo</strong> on the card to put it back.</li>
      <li class="text-muted-foreground">
        Everyone shares this board, and it resets at 00:00 UTC. The AI runs on Groq’s free tier, so
        on a busy day it may ask you to try again later.
      </li>
    </ol>
    <div class="flex flex-wrap justify-end gap-2">
      <Button
        data-testid="guide-dismiss"
        type="button"
        size="sm"
        variant="ghost"
        @click="hide(dismissGuide)"
      >
        Don’t show again
      </Button>
      <Button
        data-testid="guide-close"
        type="button"
        size="sm"
        variant="outline"
        @click="hide(closeGuide)"
      >
        Close
      </Button>
    </div>
  </aside>
</template>
