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

/** The pressed state's non-colour cue: an underline in the text colour, Ink. */
const PRESSED_CUE =
  'aria-pressed:underline aria-pressed:decoration-2 aria-pressed:underline-offset-4'

const CHANGE_TONES: Record<string, string> = {
  added: 'text-success',
  removed: 'text-destructive',
  modified: 'text-muted-foreground',
}

/**
 * The changes are to whole sections, not to lines inside them, so each chip
 * reads as a heading with a sign ("− Fixed") under a "Sections:" label.
 * "removed Fixed" read as notes being deleted. The sign is drawn; a screen
 * reader hears the word after the heading ("Fixed, removed").
 */
const CHANGE_SIGNS: Record<string, string> = {
  added: '+',
  removed: '−',
  modified: '~',
}
const CHANGE_WORDS: Record<string, string> = {
  added: 'added',
  removed: 'removed',
  modified: 'changed',
}
</script>

<template>
  <div data-testid="release-notes-diff" class="bg-background min-w-0 rounded-md border text-xs">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <span class="font-medium">
        Release notes vs
        <span class="font-mono">{{ data.baseVersion }}</span>
      </span>
      <!-- The Paper Tint fill alone is about 1.1:1 against Paper, so the pressed
           half also takes an Ink underline, keyed to aria-pressed so what is seen
           and what is announced cannot drift apart. -->
      <div class="flex gap-1" role="group" aria-label="Which version to show">
        <Button
          size="sm"
          :variant="pane === 'before' ? 'secondary' : 'ghost'"
          :class="PRESSED_CUE"
          data-testid="diff-before"
          :aria-pressed="pane === 'before'"
          @click="pane = 'before'"
        >
          Published
        </Button>
        <Button
          size="sm"
          :variant="pane === 'after' ? 'secondary' : 'ghost'"
          :class="PRESSED_CUE"
          data-testid="diff-after"
          :aria-pressed="pane === 'after'"
          @click="pane = 'after'"
        >
          Draft
        </Button>
      </div>
    </div>

    <div
      v-if="data.changedSections.length > 0"
      class="flex flex-wrap items-center gap-1.5 border-b px-3 py-2"
    >
      <span class="text-muted-foreground">Sections:</span>
      <!-- The change type is a sign and a word, never signalled by colour alone. -->
      <Badge
        v-for="section in data.changedSections"
        :key="`${section.changeType}-${section.heading}`"
        data-testid="diff-section"
        :data-change="section.changeType"
        :title="`${section.heading} section ${CHANGE_WORDS[section.changeType] ?? section.changeType}`"
        variant="outline"
        class="font-normal"
      >
        <span aria-hidden="true" :class="CHANGE_TONES[section.changeType]">{{
          CHANGE_SIGNS[section.changeType]
        }}</span>
        <span>{{ section.heading }}</span>
        <span class="sr-only">, {{ CHANGE_WORDS[section.changeType] ?? section.changeType }}</span>
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
