<script setup lang="ts">
import { computed, ref } from 'vue'
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from 'ai'
import type { DevSprintUITools } from '@devsprint/shared/tools'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import { statusLabel } from '@/features/workspace/lib/status-labels'

/**
 * The gate in front of every write (docs/wireframes.md §3, ADR-0003). It shows
 * what the agent is asking to change in the reader's terms, keeps the raw
 * arguments one click away, and stays in the transcript afterwards as the record
 * of who decided what.
 */
const props = defineProps<{
  part: ToolUIPart<DevSprintUITools> | DynamicToolUIPart
}>()

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

const outcome = computed(() => {
  const value = approval.value
  if (value?.approved === undefined) return undefined
  return { approved: value.approved, reason: value.reason }
})

/**
 * What the change means, not what it looks like as JSON. The workspace pane
 * already holds the board, so the card can name the issue being moved and where
 * it is moving from.
 */
const summary = computed((): { headline: string; detail?: string } => {
  const input = props.part.input as Record<string, unknown> | undefined
  if (input === undefined) return { headline: 'Preparing the change…' }

  if (toolName.value === 'update_issue_status' && typeof input.issueKey === 'string') {
    const issue = workspace.workspace.issues.find((candidate) => candidate.key === input.issueKey)
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

/**
 * Once an approved write has run, say how it went — the chip no longer does.
 * A failure has to show as a failure: reporting only "Approved by you" would
 * present a write that never landed as one that did.
 */
interface Outcome {
  failed: boolean
  /** Reads after "Approved by you —" or "…but it failed:". */
  text: string
  code?: string
}

const result = computed((): Outcome | undefined => {
  if (props.part.state === 'output-error') {
    return { failed: true, text: props.part.errorText || 'the change did not go through' }
  }
  if (props.part.state !== 'output-available') return undefined
  const output: unknown = props.part.output
  if (typeof output !== 'object' || output === null || !('ok' in output)) {
    return { failed: false, text: 'done' }
  }
  const envelope = output as {
    ok: boolean
    error?: { code: string; message?: string }
    data?: unknown
  }
  if (!envelope.ok) {
    // Every envelope carries a message written to be read, so it leads; the
    // code ("ISSUE_NOT_FOUND") follows as detail for whoever is debugging.
    const { code, message } = envelope.error ?? {}
    return {
      failed: true,
      text: message !== undefined && message.length > 0 ? message : 'the change did not go through',
      ...(code === undefined ? {} : { code }),
    }
  }

  // A deployment reaches `output-available` on its first frame and stays there
  // for the whole run, so "applied" would be premature while it is going and
  // wrong afterwards for a run that was cancelled. Its own status is the truth.
  // A cancelled run is not a failure: the user asked for it.
  const status = deploymentStatus(envelope.data)
  if (status !== undefined) return { failed: status === 'failed', text: `deployment ${status}` }

  return { failed: false, text: 'applied' }
})

/** The deployment inside a run_deployment result, if this is one. */
function deploymentStatus(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('deployment' in data)) return undefined
  const deployment = data.deployment
  if (typeof deployment !== 'object' || deployment === null || !('status' in deployment)) {
    return undefined
  }
  return typeof deployment.status === 'string' ? deployment.status : undefined
}

const failed = computed(() => result.value?.failed === true)

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
    </div>

    <details>
      <summary
        class="text-muted-foreground hover:text-foreground cursor-pointer rounded-sm select-none"
      >
        Raw arguments
      </summary>
      <pre class="mt-1 max-h-48 overflow-auto font-mono text-xs">{{ argumentsJson }}</pre>
    </details>

    <div v-if="!decided" class="flex flex-wrap items-center gap-2">
      <Input
        v-model="reason"
        data-testid="approval-reason"
        class="h-7 flex-1 text-xs md:text-xs"
        :aria-label="`Reason (optional), for denying: ${summary.headline}`"
        placeholder="Reason (optional)"
        autocomplete="off"
      />
      <!-- Five cards can be pending at once; each button names its change so a
           screen reader's list of buttons is not "Deny, Approve" five times. -->
      <Button
        data-testid="approval-deny"
        size="sm"
        variant="outline"
        :aria-label="`Deny: ${summary.headline}`"
        @click="respond(false)"
      >
        Deny
      </Button>
      <Button
        data-testid="approval-approve"
        size="sm"
        :aria-label="`Approve: ${summary.headline}`"
        @click="respond(true)"
      >
        Approve
      </Button>
    </div>

    <p
      v-else
      data-testid="approval-outcome"
      :class="failed ? 'text-destructive' : 'text-muted-foreground'"
    >
      <template v-if="outcome?.approved && result?.failed">
        Approved by you, but it failed: {{ result.text }}
        <span v-if="result.code" data-testid="approval-error-code" class="font-mono"
          >({{ result.code }})</span
        >
      </template>
      <template v-else-if="outcome?.approved">
        Approved by you<template v-if="result"> — {{ result.text }}</template
        >.
      </template>
      <template v-else>
        Denied<template v-if="outcome?.reason">: “{{ outcome.reason }}”</template>.
      </template>
    </p>
  </div>
</template>
