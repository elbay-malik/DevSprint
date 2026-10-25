<script setup lang="ts">
import { computed } from 'vue'
import { ISSUE_STATUSES, type Issue, type User } from '@devsprint/shared'
import { Badge } from '@/components/ui/badge'
import IssueCard from './IssueCard.vue'
import { ISSUE_STATUS_LABELS, statusLabel } from '../lib/status-labels'

const props = defineProps<{
  issues: Issue[]
  backlog: Issue[]
  users: User[]
  /** Issue key → the status a pending approval card would move it to. */
  pendingMoves?: ReadonlyMap<string, unknown>
  /** Issues the last read of the board moved, marked briefly. */
  changed?: ReadonlySet<string>
}>()

function pendingLabel(issue: Issue): string | undefined {
  return props.pendingMoves?.has(issue.key)
    ? statusLabel(props.pendingMoves.get(issue.key))
    : undefined
}

const columns = computed(() =>
  ISSUE_STATUSES.map((status) => ({
    status,
    label: ISSUE_STATUS_LABELS[status],
    issues: props.issues.filter((issue) => issue.status === status),
  })),
)

const handleById = computed(() => new Map(props.users.map((user) => [user.id, `@${user.handle}`])))
</script>

<template>
  <div class="flex min-h-0 flex-col gap-4">
    <div class="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-5">
      <div
        v-for="column in columns"
        :key="column.status"
        :data-testid="`board-column-${column.status}`"
        class="flex flex-col gap-2"
      >
        <div class="flex items-center gap-2">
          <h2 class="text-muted-foreground text-sm font-medium">{{ column.label }}</h2>
          <Badge variant="secondary">{{ column.issues.length }}</Badge>
        </div>
        <IssueCard
          v-for="issue in column.issues"
          :key="issue.id"
          :issue="issue"
          :assignee-handle="issue.assigneeId ? handleById.get(issue.assigneeId) : undefined"
          :pending-status="pendingLabel(issue)"
          :changed="changed?.has(issue.key)"
        />
        <p v-if="column.issues.length === 0" class="text-muted-foreground px-1 text-xs">
          No issues
        </p>
      </div>
    </div>
    <div v-if="backlog.length > 0" data-testid="board-backlog" class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <h2 class="text-muted-foreground text-sm font-medium">Backlog</h2>
        <Badge variant="secondary">{{ backlog.length }}</Badge>
      </div>
      <div class="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-5">
        <!-- Backlog issues sit outside the sprint's columns, so their status
             has to be on the card or a move made elsewhere (S-F) is invisible. -->
        <IssueCard
          v-for="issue in backlog"
          :key="issue.id"
          :issue="issue"
          :status-label="ISSUE_STATUS_LABELS[issue.status]"
          :pending-status="pendingLabel(issue)"
          :changed="changed?.has(issue.key)"
        />
      </div>
    </div>
  </div>
</template>
