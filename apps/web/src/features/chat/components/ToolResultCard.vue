<script setup lang="ts">
import { computed } from 'vue'
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from 'ai'
import type { ToolError, ToolResult } from '@devsprint/shared'
import type {
  BurndownData,
  DevSprintUITools,
  ListIssuesData,
  ReleaseNotesDiffData,
  RunDeploymentData,
  SearchIssuesData,
} from '@devsprint/shared/tools'
import BurndownChart from './BurndownChart.vue'
import DeploymentProgressCard from './DeploymentProgressCard.vue'
import ErrorCard from './ErrorCard.vue'
import IssueTable from './IssueTable.vue'
import ReleaseNotesDiff from './ReleaseNotesDiff.vue'
import ToolCallChip from './ToolCallChip.vue'

/**
 * Picks how a tool call renders (docs/wireframes.md §5).
 *
 * A call only earns a card once it has succeeded: everything before that — and
 * anything without a dedicated card — stays the ToolCallChip, which is the
 * documented fallback and the permanent rendering for get_sprint_status and
 * get_deployment_history.
 */
const props = defineProps<{
  part: ToolUIPart<DevSprintUITools> | DynamicToolUIPart
  live?: boolean
}>()

const toolName = computed(() => getToolName(props.part))

/** Only our own tools return the envelope; anything else falls back to the chip. */
const envelope = computed((): ToolResult<unknown> | undefined => {
  if (props.part.state !== 'output-available') return undefined
  const output: unknown = props.part.output
  if (typeof output !== 'object' || output === null || !('ok' in output)) return undefined
  return output as ToolResult<unknown>
})

const failure = computed((): ToolError | undefined => {
  const result = envelope.value
  return result && !result.ok ? result.error : undefined
})

/** Narrowed per tool: the agent's tool names map 1:1 to these payloads. */
const data = computed((): unknown => {
  const result = envelope.value
  return result?.ok ? result.data : undefined
})

const listData = computed(() => data.value as ListIssuesData | undefined)
const searchData = computed(() => data.value as SearchIssuesData | undefined)
const burndownData = computed(() => data.value as BurndownData | undefined)
const diffData = computed(() => data.value as ReleaseNotesDiffData | undefined)
const deploymentData = computed(() => data.value as RunDeploymentData | undefined)

const card = computed(() => {
  if (data.value === undefined) return 'chip'
  switch (toolName.value) {
    case 'list_issues':
      return 'issues'
    case 'search_issues':
      return 'matches'
    case 'get_burndown':
      return 'burndown'
    case 'diff_release_notes':
      return 'diff'
    case 'run_deployment':
      return 'deployment'
    default:
      return 'chip'
  }
})
</script>

<template>
  <ErrorCard v-if="failure" :tool-name="toolName" :error="failure" :input="part.input" />
  <IssueTable v-else-if="card === 'issues' && listData" :issues="listData.issues" />
  <IssueTable v-else-if="card === 'matches' && searchData" :matches="searchData.matches" />
  <BurndownChart v-else-if="card === 'burndown' && burndownData" :data="burndownData" />
  <ReleaseNotesDiff v-else-if="card === 'diff' && diffData" :data="diffData" />
  <DeploymentProgressCard
    v-else-if="card === 'deployment' && deploymentData"
    :deployment="deploymentData.deployment"
    :live="live"
  />
  <ToolCallChip v-else :part="part" :live="live" />
</template>
