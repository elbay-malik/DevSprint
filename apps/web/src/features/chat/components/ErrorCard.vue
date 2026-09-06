<script setup lang="ts">
import type { ToolError } from '@devsprint/shared'

/**
 * A failed tool call, rendered as a typed error rather than a crash or a silent
 * gap (docs/wireframes.md §2, item 6). Subdued on purpose: a tool returning
 * `ISSUE_NOT_FOUND` is a normal step the agent recovers from — scenario S-E
 * turns on exactly that — so it should read as information, not an alarm.
 */
defineProps<{ toolName: string; error: ToolError }>()
</script>

<template>
  <div
    data-testid="error-card"
    :data-code="error.code"
    class="bg-muted/40 border-destructive/40 min-w-0 rounded-md border px-3 py-2 text-xs"
  >
    <p class="flex flex-wrap items-center gap-2">
      <span class="text-muted-foreground font-mono">{{ toolName }}</span>
      <!-- The code is the label, not just a colour, so the state survives greyscale. -->
      <span data-testid="error-code" class="text-destructive font-mono font-medium">
        {{ error.code }}
      </span>
    </p>
    <p class="text-muted-foreground mt-1">{{ error.message }}</p>
  </div>
</template>
