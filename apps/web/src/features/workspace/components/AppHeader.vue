<script setup lang="ts">
import { computed, ref } from 'vue'
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
    data-testid="app-header"
    class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 lg:px-6"
  >
    <span class="text-sm font-semibold">DevSprint Copilot</span>

    <div class="flex items-center gap-2">
      <Button
        data-testid="reset-demo"
        size="sm"
        variant="outline"
        :disabled="resetting"
        @click="reset()"
      >
        {{ resetting ? 'Resetting…' : 'Reset board' }}
      </Button>
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
