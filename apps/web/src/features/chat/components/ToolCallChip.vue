<script setup lang="ts">
import { computed } from 'vue'
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from 'ai'
import type { ToolResult } from '@devsprint/shared'
import type { DevSprintUITools } from '@devsprint/shared/tools'
import { Badge } from '@/components/ui/badge'

/**
 * Fallback rendering for every tool call (docs/wireframes.md §2/§5): a compact
 * chip with the tool name and its lifecycle state, plus native disclosures for
 * the raw arguments and result. Dedicated cards (IssueTable, BurndownChart, …)
 * replace it per tool from Phase 7; approval states are labelled already so the
 * Phase 5 ApprovalCard can slot in without touching this component.
 */
const props = defineProps<{
  part: ToolUIPart<DevSprintUITools> | DynamicToolUIPart
}>()

type Tone = 'pending' | 'success' | 'error' | 'muted'

interface ChipStatus {
  label: string
  tone: Tone
}

const TONE_CLASSES: Record<Tone, string> = {
  pending: 'text-muted-foreground',
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-destructive',
  muted: 'text-muted-foreground',
}

/** Our shared envelope — every DevSprint tool returns it (docs/domain-model.md). */
function isToolResult(value: unknown): value is ToolResult<unknown> {
  return typeof value === 'object' && value !== null && 'ok' in value
}

function formatJson(value: unknown): string {
  // `input` is still undefined while the model is streaming the arguments.
  if (value === undefined) return '…'
  return JSON.stringify(value, null, 2)
}

const toolName = computed(() => getToolName(props.part))

// The switch is exhaustive over the AI SDK tool part states; the explicit
// return type makes TypeScript fail the build if the SDK adds a state.
const status = computed((): ChipStatus => {
  const part = props.part
  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      return { label: 'running…', tone: 'pending' }
    case 'approval-requested':
    case 'approval-responded':
      return { label: 'awaiting approval', tone: 'pending' }
    case 'output-denied':
      return { label: 'denied', tone: 'muted' }
    case 'output-error':
      return { label: 'failed', tone: 'error' }
    case 'output-available': {
      const output: unknown = part.output
      if (!isToolResult(output)) return { label: 'done', tone: 'success' }
      return output.ok
        ? { label: 'ok', tone: 'success' }
        : { label: output.error.code, tone: 'error' }
    }
  }
})

const errorText = computed(() =>
  props.part.state === 'output-error' ? props.part.errorText : undefined,
)
const inputJson = computed(() => formatJson(props.part.input))
const outputJson = computed(() =>
  props.part.state === 'output-available' ? formatJson(props.part.output) : undefined,
)
</script>

<template>
  <div
    data-testid="tool-call-chip"
    :data-state="part.state"
    class="bg-background flex min-w-0 flex-col gap-1 rounded-md border px-2 py-1.5 text-xs"
  >
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="outline" class="font-mono">{{ toolName }}</Badge>
      <span class="inline-flex items-center gap-1.5" :class="TONE_CLASSES[status.tone]">
        <span
          v-if="status.tone === 'pending'"
          aria-hidden="true"
          class="bg-muted-foreground/60 inline-block size-2 animate-pulse rounded-full"
        />
        <span data-testid="tool-call-state">{{ status.label }}</span>
      </span>
      <span v-if="errorText" class="text-destructive min-w-0 truncate">{{ errorText }}</span>
    </div>
    <details>
      <summary class="text-muted-foreground cursor-pointer select-none">Arguments</summary>
      <pre class="mt-1 max-h-64 overflow-auto font-mono text-xs">{{ inputJson }}</pre>
    </details>
    <details v-if="outputJson !== undefined">
      <summary class="text-muted-foreground cursor-pointer select-none">Result</summary>
      <pre class="mt-1 max-h-64 overflow-auto font-mono text-xs">{{ outputJson }}</pre>
    </details>
  </div>
</template>
