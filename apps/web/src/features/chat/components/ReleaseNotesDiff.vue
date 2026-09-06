<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ReleaseNotesDiffData } from '@devsprint/shared/tools'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * The draft against the last published version (docs/wireframes.md §5).
 *
 * The two texts are shown one at a time rather than side by side: in a chat
 * column roughly 400px wide, two panes of markdown would each be too narrow to
 * read. The changed-section list is what carries the comparison, so the reader
 * knows what to look for before switching panes.
 */
const props = defineProps<{ data: ReleaseNotesDiffData }>()

const pane = ref<'after' | 'before'>('after')

const shown = computed(() => (pane.value === 'after' ? props.data.after : props.data.before))

const CHANGE_TONES: Record<string, string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  removed: 'text-destructive',
  modified: 'text-muted-foreground',
}
</script>

<template>
  <div data-testid="release-notes-diff" class="bg-background min-w-0 rounded-md border text-xs">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <span class="font-medium">
        Release notes vs
        <span class="font-mono">{{ data.baseVersion }}</span>
      </span>
      <div class="flex gap-1" role="group" aria-label="Which version to show">
        <Button
          size="sm"
          :variant="pane === 'before' ? 'secondary' : 'ghost'"
          data-testid="diff-before"
          :aria-pressed="pane === 'before'"
          @click="pane = 'before'"
        >
          Published
        </Button>
        <Button
          size="sm"
          :variant="pane === 'after' ? 'secondary' : 'ghost'"
          data-testid="diff-after"
          :aria-pressed="pane === 'after'"
          @click="pane = 'after'"
        >
          Draft
        </Button>
      </div>
    </div>

    <div v-if="data.changedSections.length > 0" class="flex flex-wrap gap-1.5 border-b px-3 py-2">
      <!-- The change type is spelled out, never signalled by colour alone. -->
      <Badge
        v-for="section in data.changedSections"
        :key="`${section.changeType}-${section.heading}`"
        variant="outline"
        class="font-normal"
      >
        <span :class="CHANGE_TONES[section.changeType]">{{ section.changeType }}</span>
        <span class="ml-1">{{ section.heading }}</span>
      </Badge>
    </div>
    <p v-else class="text-muted-foreground border-b px-3 py-2">
      The draft matches {{ data.baseVersion }} section for section.
    </p>

    <pre
      data-testid="diff-pane"
      class="max-h-64 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap"
      >{{ shown }}</pre>
  </div>
</template>
