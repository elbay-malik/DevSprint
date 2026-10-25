<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from 'ai'
import type { DevSprintUITools } from '@devsprint/shared/tools'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import { statusLabel } from '@/features/workspace/lib/status-labels'
import { approvalOutcome } from '../lib/approvals'

/**
 * The gate in front of every write (docs/wireframes.md §3, ADR-0003). It shows
 * what the agent is asking to change in the reader's terms, keeps the raw
 * arguments one click away, and stays in the transcript afterwards as the record
 * of who decided what.
 */
const props = withDefaults(
  defineProps<{
    part: ToolUIPart<DevSprintUITools> | DynamicToolUIPart
    /**
     * Whether this card holds its region's one Ink button. Five open cards in
     * one message would otherwise be five equal fills, so the transcript gives
     * it to the first undecided card only and the rest decide in outline.
     */
    lead?: boolean
  }>(),
  { lead: true },
)

const chat = useDevSprintChat()
const workspace = useWorkspaceStore()
const reason = ref('')

const toolName = computed(() => getToolName(props.part))

/** Present from `approval-requested` onwards; `approved` fills in once answered. */
const approval = computed((): { id: string; approved?: boolean; reason?: string } | undefined =>
  'approval' in props.part ? props.part.approval : undefined,
)

/** Pending until the user answers; the card then becomes an audit record. */
const decided = computed(() => props.part.state !== 'approval-requested')

/**
 * Once answered, the card says how it went — the chip no longer does. The words
 * come from one place so the status announcement repeats them exactly.
 */
const outcome = computed(() => approvalOutcome(props.part))

const toolInput = computed(() => props.part.input as Record<string, unknown> | undefined)

/** The board's copy of the issue a status change targets, if it has one. */
const targetIssue = computed(() => {
  const key = toolInput.value?.issueKey
  if (toolName.value !== 'update_issue_status' || typeof key !== 'string') return undefined
  return workspace.workspace.issues.find((candidate) => candidate.key === key)
})

/**
 * A status change for a key the board does not hold (S-E). Approving it can
 * only fail, so the card says so before the decision and makes Deny the
 * default. Approve stays: the write's own typed error is what the agent's
 * recovery answers to, and the person may know something the board does not.
 */
const missingIssueKey = computed((): string | undefined => {
  const key = toolInput.value?.issueKey
  if (decided.value || toolName.value !== 'update_issue_status' || typeof key !== 'string') {
    return undefined
  }
  return targetIssue.value === undefined ? key : undefined
})

const warningId = useId()

/** The one Ink button, if this card holds it: Approve, or Deny for a change that cannot land. */
const approveVariant = computed(() =>
  props.lead && missingIssueKey.value === undefined ? 'default' : 'outline',
)
const denyVariant = computed(() =>
  props.lead && missingIssueKey.value !== undefined ? 'default' : 'outline',
)

/**
 * What the change means, not what it looks like as JSON. The workspace pane
 * already holds the board, so the card can name the issue being moved and where
 * it is moving from.
 */
const summary = computed((): { headline: string; detail?: string } => {
  const input = props.part.input as Record<string, unknown> | undefined
  if (input === undefined) return { headline: 'Preparing the change…' }

  if (toolName.value === 'update_issue_status' && typeof input.issueKey === 'string') {
    const issue = targetIssue.value
    // The "from" status is read live, so it is only truthful while the change is
    // still pending. Once the board catches up an executed write, keeping it
    // would rewrite this record into a nonsense "done → done".
    const from = issue && !decided.value ? `${statusLabel(issue.status)} → ` : ''
    return {
      headline: `${input.issueKey}: ${from}${statusLabel(input.status)}`,
      ...(issue ? { detail: issue.title } : {}),
    }
  }
  if (toolName.value === 'create_issue' && typeof input.title === 'string') {
    const where = typeof input.sprintId === 'string' ? input.sprintId : 'the backlog'
    const type = typeof input.type === 'string' ? input.type : 'issue'
    return { headline: `New ${type} in ${where}`, detail: input.title }
  }
  if (toolName.value === 'create_release_notes' && typeof input.version === 'string') {
    return { headline: `Save ${input.version} release notes as a draft` }
  }
  if (
    toolName.value === 'run_deployment' &&
    typeof input.version === 'string' &&
    typeof input.environment === 'string'
  ) {
    return { headline: `Deploy ${input.version} to ${input.environment}` }
  }
  return { headline: `Run ${toolName.value}` }
})

const argumentsJson = computed(() => JSON.stringify(props.part.input ?? {}, null, 2))

function respond(approved: boolean) {
  const id = approval.value?.id
  // Without an id there is nothing to answer, and the SDK would no-op silently.
  if (id === undefined) return
  const trimmed = reason.value.trim()
  chat.addToolApprovalResponse({
    id,
    approved,
    ...(trimmed.length > 0 ? { reason: trimmed } : {}),
  })
}
</script>

<template>
  <div
    data-testid="approval-card"
    :data-state="part.state"
    :data-tool="toolName"
    class="bg-background flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2 text-xs"
  >
    <p class="text-muted-foreground font-medium">
      Approval required: <span class="font-mono">{{ toolName }}</span>
    </p>

    <div>
      <p data-testid="approval-headline" class="text-foreground text-sm font-medium">
        {{ summary.headline }}
      </p>
      <p v-if="summary.detail" class="text-muted-foreground">{{ summary.detail }}</p>
      <p
        v-if="missingIssueKey"
        :id="warningId"
        data-testid="approval-warning"
        class="text-destructive"
      >
        <span class="font-mono">{{ missingIssueKey }}</span> isn’t on the board.
      </p>
    </div>

    <details>
      <summary
        class="text-muted-foreground hover:text-foreground cursor-pointer rounded-sm select-none"
      >
        Raw arguments
      </summary>
      <pre class="mt-1 max-h-48 overflow-auto font-mono text-xs">{{ argumentsJson }}</pre>
    </details>

    <!--
      The decision is a named group, and the transcript moves focus here when a
      turn ends waiting on it (tabindex -1: reachable by script, not by Tab), so
      a keyboard user lands on the change rather than on the page.
    -->
    <div
      v-if="!decided"
      role="group"
      :aria-label="`Decision: ${summary.headline}`"
      :aria-describedby="missingIssueKey ? warningId : undefined"
      tabindex="-1"
      data-approval-focus
      class="focus-visible:outline-ring flex flex-wrap items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <!-- 16px below md like every other field, so iOS does not zoom on focus. -->
      <Input
        v-model="reason"
        data-testid="approval-reason"
        class="h-7 flex-1 text-base md:text-xs"
        :aria-label="`Reason (optional), for denying: ${summary.headline}`"
        placeholder="Reason (optional)"
        autocomplete="off"
      />
      <!-- Five cards can be pending at once; each button names its change so a
           screen reader's list of buttons is not "Deny, Approve" five times. -->
      <Button
        data-testid="approval-deny"
        size="sm"
        :variant="denyVariant"
        :aria-label="`Deny: ${summary.headline}`"
        @click="respond(false)"
      >
        Deny
      </Button>
      <Button
        data-testid="approval-approve"
        size="sm"
        :variant="approveVariant"
        :aria-label="`Approve: ${summary.headline}`"
        @click="respond(true)"
      >
        Approve
      </Button>
    </div>

    <p
      v-else-if="outcome"
      data-testid="approval-outcome"
      :class="outcome.failed ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ outcome.text }}
      <span v-if="outcome.code" data-testid="approval-error-code" class="font-mono"
        >({{ outcome.code }})</span
      >
    </p>
  </div>
</template>
