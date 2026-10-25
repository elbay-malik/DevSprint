<script setup lang="ts">
import type { Issue } from '@devsprint/shared'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

defineProps<{
  issue: Issue
  assigneeHandle?: string
  /** Shown only where the column does not already say it — the backlog. */
  statusLabel?: string
  /** Where a pending approval card would move this issue ("Done"). */
  pendingStatus?: string
  /** The last read of the board moved this issue; main.css marks it briefly. */
  changed?: boolean
}>()
</script>

<template>
  <!-- A pending move is a dashed ring, the drawn convention for "proposed",
       with the destination in words beneath, so it reads in greyscale. The
       dashes replace the card's hairline at the same 1px, drawn inside its own
       edge, so a pending card keeps its footprint, never touches a neighbour
       and lines up with the column heading. -->
  <Card
    data-testid="issue-card"
    :data-issue-key="issue.key"
    :data-pending-move="pendingStatus === undefined ? undefined : ''"
    :data-board-change="changed ? '' : undefined"
    class="gap-0 py-3"
    :class="
      pendingStatus !== undefined &&
      'outline-ring ring-0 outline-1 -outline-offset-1 outline-dashed'
    "
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
      <p v-if="assigneeHandle" class="text-muted-foreground text-xs">{{ assigneeHandle }}</p>
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
