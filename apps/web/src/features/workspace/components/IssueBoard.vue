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

/** The count badge reads "2" on screen and "2 issues" to a screen reader. */
const issuesUnit = (count: number): string => (count === 1 ? ' issue' : ' issues')

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
        <!-- The count sits in the heading, so a heading jump hears "Done, 6 issues". -->
        <h2 class="text-muted-foreground flex items-center gap-2 text-sm font-medium">
          {{ column.label }}
          <Badge variant="secondary" class="tabular-nums"
            >{{ column.issues.length
            }}<span class="sr-only">{{ issuesUnit(column.issues.length) }}</span></Badge
          >
        </h2>
        <!-- role="list": Safari drops list semantics from a list styled without
             markers, and the list is what tells a screen reader how many cards
             a column holds. -->
        <ul v-if="column.issues.length > 0" role="list" class="flex flex-col gap-2">
          <li v-for="issue in column.issues" :key="issue.id">
            <IssueCard
              :issue="issue"
              :assignee-handle="issue.assigneeId ? handleById.get(issue.assigneeId) : undefined"
              :pending-status="pendingLabel(issue)"
              :changed="changed?.has(issue.key)"
            />
          </li>
        </ul>
        <!-- An empty column is a compact slot the height of a line, drawn in the
             Rule colour, so it reads as a place on the board rather than a
             caption left under its heading. -->
        <p
          v-else
          data-testid="board-column-empty"
          class="text-muted-foreground rounded-xl border px-3 py-1.5 text-xs"
        >
          No issues
        </p>
      </div>
    </div>
    <div v-if="backlog.length > 0" data-testid="board-backlog" class="flex flex-col gap-2">
      <!-- The rule above the board jumps here: focusable from script only, and
           scrolled clear of the pane's edge. -->
      <h2
        id="board-backlog-heading"
        tabindex="-1"
        class="text-muted-foreground flex scroll-mt-4 items-center gap-2 text-sm font-medium outline-none"
      >
        Backlog
        <Badge variant="secondary" class="tabular-nums"
          >{{ backlog.length }}<span class="sr-only">{{ issuesUnit(backlog.length) }}</span></Badge
        >
      </h2>
      <ul role="list" class="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-5">
        <!-- Backlog issues sit outside the sprint's columns, so their status
             has to be on the card or a move made elsewhere (S-F) is invisible. -->
        <li v-for="issue in backlog" :key="issue.id" class="grid">
          <IssueCard
            :issue="issue"
            :status-label="ISSUE_STATUS_LABELS[issue.status]"
            :pending-status="pendingLabel(issue)"
            :changed="changed?.has(issue.key)"
          />
        </li>
      </ul>
    </div>
  </div>
</template>
