<script setup lang="ts">
import { computed } from 'vue'
import type { ToolError } from '@devsprint/shared'
import { toolErrorCopy } from '../lib/error-copy'

/**
 * A failed tool call, rendered as a typed error rather than a crash or a silent
 * gap (docs/wireframes.md §2, item 6). Subdued on purpose: a tool returning
 * `ISSUE_NOT_FOUND` is a normal step the agent recovers from — scenario S-E
 * turns on exactly that — so it should read as information, not an alarm.
 */
const props = defineProps<{
  toolName: string
  error: ToolError
  /** The call's arguments, so the copy can name what it was about ("DS-42"). */
  input?: unknown
}>()

/** The person's words for the code, never the model-facing message. */
const message = computed(() => toolErrorCopy(props.toolName, props.error.code, props.input))
</script>

<template>
  <div
    data-testid="error-card"
    :data-code="error.code"
    class="bg-background border-destructive/40 min-w-0 rounded-md border px-3 py-2 text-xs"
  >
    <!-- What failed, in words, leads; the code follows for whoever is debugging.
         The code stays a visible label, so the state survives greyscale. -->
    <p data-testid="error-message" class="text-foreground">{{ message }}</p>
    <p class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 font-mono">
      <span>{{ toolName }}</span>
      <span data-testid="error-code" class="text-destructive font-medium">{{ error.code }}</span>
    </p>
  </div>
</template>
