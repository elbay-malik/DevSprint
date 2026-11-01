<script setup lang="ts">
import { computed } from 'vue'
import type { Issue } from '@devsprint/shared'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

const props = defineProps<{
  issue: Issue
  assigneeHandle?: string
  /** Shown only where the column does not already say it — the backlog. */
  statusLabel?: string
  /** Where a pending approval card would move this issue ("Done"). */
  pendingStatus?: string
  /**
   * Who a pending approval card would hand this issue to, as the board names
   * people ("@dana"); null when it would take the issue off whoever holds it.
   */
  pendingAssignee?: string | null
  /** The last read of the board added, moved or handed on this issue; main.css marks it briefly. */
  changed?: boolean
}>()

/** Either kind of pending change draws the same ring: the card is proposed, not moved. */
const pending = computed(
  () => props.pendingStatus !== undefined || props.pendingAssignee !== undefined,
)
</script>

<template>
  <!-- A pending move or reassignment is a dashed ring, the drawn convention
       for "proposed", with the destination or the new assignee in words
       beneath, so it reads in greyscale. A reassignment leaves the card in
       its column: only a status change says where it would go. The
       dashes replace the card's hairline at the same 1px, drawn inside its own
       edge, so a pending card keeps its footprint, never touches a neighbour
       and lines up with the column heading. -->
  <Card
    data-testid="issue-card"
    :data-issue-key="issue.key"
    :data-pending-move="pendingStatus === undefined ? undefined : ''"
    :data-pending-assignee="pendingAssignee === undefined ? undefined : ''"
    :data-board-change="changed ? '' : undefined"
    class="gap-0 py-3"
    :class="pending && 'outline-ring ring-0 outline-1 -outline-offset-1 outline-dashed'"
  >
    <CardContent class="flex flex-col gap-1.5 px-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-muted-foreground font-mono text-xs">{{ issue.key }}</span>
        <Badge variant="outline" class="tabular-nums"
          >{{ issue.points
          }}<span class="sr-only">{{ issue.points === 1 ? ' point' : ' points' }}</span></Badge
        >
      </div>
      <p class="text-sm leading-snug font-medium">{{ issue.title }}</p>
      <p v-if="assigneeHandle" data-testid="issue-assignee" class="text-muted-foreground text-xs">
        {{ assigneeHandle }}
      </p>
      <!-- Right under who holds it now, so "@ben" then "→ @dana" reads as the hand-on. -->
      <p
        v-if="pendingAssignee !== undefined"
        data-testid="issue-pending-assignee"
        class="text-foreground text-xs font-medium"
      >
        <span aria-hidden="true">→ </span
        ><template v-if="pendingAssignee === null"
          ><span class="sr-only">Awaiting approval to unassign</span
          ><span aria-hidden="true">Unassigned</span></template
        ><template v-else
          ><span class="sr-only">Awaiting approval to assign to </span
          >{{ pendingAssignee }}</template
        >
      </p>
      <p v-if="statusLabel" data-testid="issue-status" class="text-muted-foreground text-xs">
        {{ statusLabel }}
      </p>
      <p
        v-if="pendingStatus !== undefined"
        data-testid="issue-pending-move"
        class="text-foreground text-xs font-medium"
      >
        <span aria-hidden="true">→ </span><span class="sr-only">Awaiting approval to move to </span
        >{{ pendingStatus }}
      </p>
    </CardContent>
  </Card>
</template>
