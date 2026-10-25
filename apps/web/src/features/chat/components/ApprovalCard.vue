<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { getToolName, type DynamicToolUIPart, type ToolUIPart } from 'ai'
import { toast } from 'vue-sonner'
import type { DevSprintUITools } from '@devsprint/shared/tools'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import { findIssueByKey } from '@/features/workspace/lib/issue-key'
import { statusLabel } from '@/features/workspace/lib/status-labels'
import { approvalOutcome } from '../lib/approvals'
import {
  approvalRecord,
  formatDecisionTime,
  recordDecision,
  recordUndo,
  undoRecordOf,
} from '../lib/approval-records'
import { errorCopyText, toolErrorCopy } from '../lib/error-copy'
import { requestUndo, undoneCopy, undoTargetOf } from '../lib/undo'

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
     * it to the first undecided card only and the rest decide in outline. While
     * the group offers "Approve all", that button holds it and no card does.
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
 * The board as it stood, and the time, when the person answered. Taken in
 * `respond`, while the change is still pending, and kept outside the card: the
 * transcript remounts it on every state change.
 */
const record = computed(() => approvalRecord(approval.value?.id))

/**
 * Once answered, the card says how it went — the chip no longer does. The words
 * come from one place so the status announcement repeats them exactly.
 */
const outcome = computed(() => {
  const decidedAt = record.value?.decidedAt
  return approvalOutcome(
    props.part,
    decidedAt === undefined ? undefined : formatDecisionTime(decidedAt),
  )
})

/** The glyph's tone; the line's own colour already says failed or settled. */
const OUTCOME_MARK_TONES: Record<string, string> = {
  '●': 'text-success',
}

const toolInput = computed(() => props.part.input as Record<string, unknown> | undefined)

/**
 * The board's copy of the issue a status change targets, if it has one, found
 * the way the api finds it, so "ds-7" is DS-7 here too.
 */
const targetIssue = computed(() => {
  const key = toolInput.value?.issueKey
  if (toolName.value !== 'update_issue_status' || typeof key !== 'string') return undefined
  return findIssueByKey(workspace.workspace.issues, key)
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
    // While pending, the "from" status is the board's. Once decided it is the one
    // captured at the decision: read live, the board catching up an executed write
    // would rewrite this record into a nonsense "done → done".
    const fromStatus = decided.value ? record.value?.from : issue?.status
    const from = fromStatus === undefined ? '' : `${statusLabel(fromStatus)} → `
    // Named as the board spells it, so the card and the board agree on "DS-7".
    return {
      headline: `${issue?.key ?? input.issueKey}: ${from}${statusLabel(input.status)}`,
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
 * An applied board write the workspace recorded can be put back, once. What it
 * puts back is the workspace's own record (the route takes only the change id),
 * so the card never says what the issue was; the reply does.
 */
const undoTarget = computed(() => undoTargetOf(props.part))
const undo = computed(() => undoRecordOf(approval.value?.id))
const undoing = ref(false)
const undoLine = ref<HTMLElement>()

async function undoChange(): Promise<void> {
  const target = undoTarget.value
  const id = approval.value?.id
  if (target === undefined || id === undefined || undoing.value) return
  undoing.value = true
  try {
    const result = await requestUndo(target.changeId)
    const copy = result.ok
      ? undoneCopy(result.data, formatDecisionTime(new Date(result.data.undoneAt)))
      : toolErrorCopy('undo', result.error.code, { issueKey: target.issueKey })
    recordUndo(id, { state: result.ok ? 'undone' : 'refused', copy }, errorCopyText(copy))
  } catch (error) {
    // Nothing is known about the board, so the Undo stays for another try.
    console.warn('[workspace] undo failed:', error)
    toast.error("Couldn't undo the change", { description: 'Try again in a moment.' })
    return
  } finally {
    undoing.value = false
  }
  // The button is gone, and with it the focus; the line that replaced it is
  // the sensible place to land, and the status line has already said it.
  await nextTick()
  const active = document.activeElement
  if (active === null || active === document.body) undoLine.value?.focus()
  await workspace.hydrate()
}

function respond(approved: boolean) {
  const id = approval.value?.id
  // Without an id there is nothing to answer, and the SDK would no-op silently.
  if (id === undefined) return
  recordDecision(id, {
    decidedAt: new Date(),
    ...(targetIssue.value ? { from: targetIssue.value.status } : {}),
  })
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
    class="bg-background flex min-w-0 scroll-mt-3 flex-col gap-2 rounded-md border px-3 py-2 text-xs"
  >
    <!-- No label above the headline: it would say "Approval required" on a
         card that is long decided. The tool sits in a quiet meta line below. -->
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
      <p data-testid="approval-tool" class="text-muted-foreground font-mono">{{ toolName }}</p>
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

    <!-- The record and, once applied, its one quiet way back. Undo is ghost: the
         Ink belongs to a decision still open, not to a record. -->
    <div v-else-if="outcome" class="flex flex-wrap items-center gap-x-2">
      <p
        data-testid="approval-outcome"
        :class="outcome.failed ? 'text-destructive' : 'text-muted-foreground'"
      >
        <!-- The glyph is drawn, not read: the words already say how it went. Mono,
           because Geist has none of the glyphs and the fallback drew ● at half
           the height of ◐. -->
        <span
          aria-hidden="true"
          data-testid="approval-outcome-mark"
          class="font-mono"
          :class="OUTCOME_MARK_TONES[outcome.mark]"
          >{{ outcome.mark }}</span
        >
        <!-- A typed error's code is the ErrorCard's, right below, in Stop Red;
           repeated here it pushed the line onto a second one at 1440. -->
        {{ outcome.text }}{{ outcome.code === undefined ? '' : '.' }}
      </p>
      <Button
        v-if="undoTarget && !undo"
        data-testid="approval-undo"
        type="button"
        variant="ghost"
        size="xs"
        :aria-label="`Undo: ${summary.headline}`"
        :aria-disabled="undoing || undefined"
        @click="undoChange"
      >
        {{ undoing ? 'Undoing…' : 'Undo' }}
      </Button>
    </div>
    <!-- tabindex -1: focus lands here when the Undo that made it is gone. -->
    <p
      v-if="undo"
      ref="undoLine"
      tabindex="-1"
      data-testid="approval-undo-record"
      :data-state="undo.state"
      class="focus-visible:outline-ring rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      :class="undo.state === 'refused' ? 'text-destructive' : 'text-muted-foreground'"
    >
      <!-- No mono face on the stack draws ↶, so the fallback's came out at half
           the size and weight of the ● above. Scaled, and in the text colour, to match it. -->
      <span
        v-if="undo.state === 'undone'"
        aria-hidden="true"
        data-testid="approval-undo-mark"
        class="text-foreground font-mono text-[1.5em] leading-none"
        >↶
      </span>
      <template v-for="(piece, index) in undo.copy" :key="index">
        <span v-if="typeof piece === 'string'">{{ piece }}</span>
        <span v-else class="font-mono">{{ piece.id }}</span>
      </template>
    </p>
  </div>
</template>
