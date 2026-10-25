<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { WORKSPACE_RESET_ENDPOINT } from '@/lib/api'
import { nextTheme, resolvedTheme, setTheme, theme } from '@/lib/theme'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * The app shell's header bar (docs/wireframes.md §1).
 *
 * Both controls existed on paper and in prose long before they existed here.
 * The Reset demo button in particular was load-bearing in an argument it could
 * not support: `apps/api/README.md` and ADR-0014 both justify leaving
 * `POST /api/workspace/reset` ungated partly *because* it backs a button in
 * the live demo's header — and there was no button, so a visitor who wanted
 * the board back had no way to ask for it short of curl.
 *
 * The sprint selector from the same wireframe is still unbuilt: the seed has
 * two sprints and the agent scopes by sprint itself, so it buys nothing yet.
 */
const workspace = useWorkspaceStore()
const resetting = ref(false)

/** How long "Reset for everyone?" waits for a Confirm before backing out. */
const RESET_CONFIRM_MS = 4000

const themeLabel = computed(() =>
  theme.value === 'system'
    ? `System (${resolvedTheme('system')})`
    : theme.value === 'dark'
      ? 'Dark'
      : 'Light',
)

const themeGlyph = computed(() =>
  theme.value === 'system' ? '◐' : resolvedTheme(theme.value) === 'dark' ? '●' : '○',
)

/**
 * Reset is two steps, inline rather than a modal: the board is shared, so one
 * click would discard every other visitor's work. The first click asks "Reset
 * for everyone?" and moves focus to Confirm; Esc, Cancel, focus leaving the
 * question, a press elsewhere or RESET_CONFIRM_MS without an answer all back
 * out.
 */
const confirming = ref(false)
const header = ref<HTMLElement>()
const confirmGroup = ref<HTMLElement>()
let backOut: ReturnType<typeof setTimeout> | undefined

function focusResetButton(): void {
  header.value?.querySelector<HTMLElement>('[data-testid="reset-demo"]')?.focus()
}

async function askToReset(): Promise<void> {
  if (resetting.value) return
  confirming.value = true
  clearTimeout(backOut)
  backOut = setTimeout(() => cancelReset(), RESET_CONFIRM_MS)
  await nextTick()
  confirmGroup.value?.querySelector<HTMLElement>('[data-testid="reset-demo-confirm"]')?.focus()
}

/** Backs out. Focus returns to Reset only if it was inside the question, never pulled from elsewhere. */
async function cancelReset(): Promise<void> {
  clearTimeout(backOut)
  if (!confirming.value) return
  const hadFocus = confirmGroup.value?.contains(document.activeElement) ?? false
  confirming.value = false
  await nextTick()
  if (hadFocus) focusResetButton()
}

function outsideQuestion(node: EventTarget | null): boolean {
  return node instanceof Node && !(confirmGroup.value?.contains(node) ?? false)
}

/**
 * Focus moving to another control backs out. Focus moving to nothing does
 * not: Safari focuses no button on click, so a click on Confirm while Cancel
 * holds focus would otherwise remove Confirm before the click lands. A press
 * anywhere outside covers that case instead.
 */
function onFocusOut(event: FocusEvent): void {
  if (outsideQuestion(event.relatedTarget)) void cancelReset()
}

useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (confirming.value && outsideQuestion(event.target)) void cancelReset()
})

async function confirmReset(): Promise<void> {
  clearTimeout(backOut)
  confirming.value = false
  await nextTick()
  focusResetButton()
  await reset()
}

onBeforeUnmount(() => clearTimeout(backOut))

/**
 * Below lg the copilot sits under the whole board, about 1,200px down on a
 * phone, with nothing on the first screen pointing at it. This takes the
 * reader there and into the composer; from lg up both panes share the view.
 */
function goToCopilot(): void {
  const pane = document.querySelector<HTMLElement>('[data-testid="chat-pane"]')
  if (!pane) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  // Optional: jsdom-like environments have no scrollIntoView.
  pane.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  pane.querySelector<HTMLElement>('[data-chat-composer]')?.focus({ preventScroll: true })
}

async function reset(): Promise<void> {
  resetting.value = true
  try {
    // fetch() only throws on a network failure, so a 500 has to be read off
    // the response, or a failed reset would look like it worked.
    const res = await fetch(WORKSPACE_RESET_ENDPOINT, { method: 'POST' })
    if (!res.ok) throw new Error(`reset answered ${res.status}`)
  } catch (error) {
    console.warn('[workspace] reset failed:', error)
    toast.error("Couldn't reset the board", { description: 'Try again in a moment.' })
  } finally {
    resetting.value = false
    await workspace.hydrate()
  }
}
</script>

<template>
  <header
    ref="header"
    data-testid="app-header"
    class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 lg:px-6"
  >
    <span class="text-sm font-semibold">DevSprint Copilot</span>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <Button
        data-testid="jump-to-copilot"
        size="sm"
        variant="outline"
        class="lg:hidden"
        @click="goToCopilot()"
      >
        Copilot<span aria-hidden="true">↓</span>
      </Button>
      <!-- While asking, the question replaces the button: a named group, so a
           screen reader landing on Confirm hears what it confirms. -->
      <div
        v-if="confirming"
        ref="confirmGroup"
        role="group"
        aria-labelledby="reset-confirm-question"
        data-testid="reset-demo-question"
        class="flex items-center gap-2"
        @focusout="onFocusOut"
        @keydown.esc.prevent="cancelReset()"
      >
        <span id="reset-confirm-question" class="text-xs font-medium">Reset for everyone?</span>
        <Button
          data-testid="reset-demo-confirm"
          size="sm"
          variant="outline"
          aria-describedby="reset-demo-hint"
          @click="confirmReset()"
        >
          Confirm
        </Button>
        <Button data-testid="reset-demo-cancel" size="sm" variant="ghost" @click="cancelReset()">
          Cancel
        </Button>
      </div>
      <!-- aria-disabled, not disabled, while resetting: Confirm hands focus
           back here, and a disabled button would drop it to the page. -->
      <Button
        v-else
        data-testid="reset-demo"
        size="sm"
        variant="outline"
        title="Restores the seed board for every visitor"
        aria-describedby="reset-demo-hint"
        :aria-disabled="resetting ? 'true' : undefined"
        class="aria-disabled:opacity-50"
        @click="askToReset()"
      >
        {{ resetting ? 'Resetting…' : 'Reset board' }}
      </Button>
      <span id="reset-demo-hint" class="sr-only">Restores the seed board for every visitor.</span>
      <Button
        data-testid="theme-toggle"
        size="sm"
        variant="ghost"
        :aria-label="`Theme: ${themeLabel}. Activate to change.`"
        :title="`Theme: ${themeLabel}`"
        @click="setTheme(nextTheme(theme))"
      >
        <span aria-hidden="true">{{ themeGlyph }}</span>
        <span class="sr-only">{{ themeLabel }}</span>
      </Button>
    </div>
  </header>
</template>
