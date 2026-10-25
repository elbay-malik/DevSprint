<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useNow } from '@vueuse/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDevSprintChat } from '@/features/chat/composables/useDevSprintChat'
import { usePendingMoves } from '@/features/chat/composables/usePendingMoves'
import IssueBoard from './IssueBoard.vue'
import SprintStatsCards from './SprintStatsCards.vue'
import { useReadOnReturn } from '../composables/useReadOnReturn'
import { lastReadLabel } from '../lib/last-read'

const store = useWorkspaceStore()
const chat = useDevSprintChat()
const pendingMoves = usePendingMoves()

onMounted(() => void store.hydrate())

/**
 * Writes made outside this tab (an MCP host, another visitor) show up when the
 * reader comes back to it, through the same hydrate and changed-card mark as
 * an approved move. Not while a turn streams: its own read follows.
 */
useReadOnReturn({
  read: () => store.hydrate(),
  blocked: () => store.hydrating || chat.status === 'submitted' || chat.status === 'streaming',
  lastReadAt: () => store.readAt,
})

/** "Updated 2 min ago", refreshed every 30s; only while the board is the Worker's. */
const now = useNow({ interval: 30_000 })
const updated = computed(() =>
  store.source === 'api' && store.readAt !== undefined
    ? { label: lastReadLabel(store.readAt, now.value.getTime()), at: new Date(store.readAt) }
    : undefined,
)

/**
 * The backlog sits under the sprint's columns, and a full Done column pushes it
 * out of view. Its count rides on the rule above the board, and the jump moves
 * focus to its heading, which scrolls whichever container holds it.
 */
function showBacklog(): void {
  document.getElementById('board-backlog-heading')?.focus()
}

/**
 * An approved write lands in the Worker, not in this store, so the board would
 * otherwise keep showing the issue where it used to be. Re-reading when the turn
 * settles is what makes the pane live, as docs/wireframes.md §1 promises:
 * approve a status change in the chat and the issue moves columns.
 */
watch(
  () => chat.status,
  (status, previous) => {
    if (status === 'ready' && previous !== 'ready') void store.hydrate()
  },
)
</script>

<template>
  <!-- The pane scrolls on its own and holds nothing focusable, so without a tab
       stop a keyboard user could never reach the lower columns. Its focus outline
       is the shared scroll-region rule in main.css. -->
  <section
    data-testid="workspace-pane"
    tabindex="0"
    aria-label="Sprint board"
    class="@container flex min-h-0 flex-col gap-4 p-4 lg:overflow-y-auto lg:p-6"
  >
    <!-- The sprint name leads; the header bar already names the product, so the
         project needs no label above it. The source badge sits on the heading's
         line as the board's status. -->
    <header>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h1 class="text-lg font-semibold">
          {{ store.activeSprint?.name ?? 'No active sprint' }}
        </h1>
        <!-- Connection status, not the sprint's: the board is read from the
             Worker, or it is the offline seed. -->
        <Badge variant="secondary" data-testid="workspace-source">
          {{ store.source === 'api' ? 'Live board' : 'Offline' }}
        </Badge>
        <time
          v-if="updated"
          data-testid="workspace-updated"
          class="text-muted-foreground text-xs"
          :datetime="updated.at.toISOString()"
          :title="updated.at.toLocaleString()"
        >
          {{ updated.label }}
        </time>
      </div>
      <p class="text-muted-foreground text-sm">{{ store.activeSprint?.goal }}</p>
    </header>
    <SprintStatsCards :stats="store.stats" />
    <div class="flex items-center gap-3">
      <Separator class="flex-1" />
      <Button
        v-if="store.backlogIssues.length > 0"
        data-testid="jump-to-backlog"
        size="sm"
        variant="ghost"
        class="tabular-nums"
        @click="showBacklog()"
      >
        <span class="sr-only">Jump to the </span>Backlog<span class="sr-only">,</span>
        {{ store.backlogIssues.length }}
        <span class="sr-only">{{ store.backlogIssues.length === 1 ? 'issue' : 'issues' }}</span>
        <span aria-hidden="true">↓</span>
      </Button>
    </div>
    <IssueBoard
      :issues="store.sprintIssues"
      :backlog="store.backlogIssues"
      :users="store.users"
      :pending-moves="pendingMoves"
      :changed="store.recentlyChanged"
    />
  </section>
</template>
