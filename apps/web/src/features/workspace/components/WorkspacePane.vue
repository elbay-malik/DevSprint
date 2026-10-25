<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDevSprintChat } from '@/features/chat/composables/useDevSprintChat'
import { usePendingMoves } from '@/features/chat/composables/usePendingMoves'
import IssueBoard from './IssueBoard.vue'
import SprintStatsCards from './SprintStatsCards.vue'

const store = useWorkspaceStore()
const chat = useDevSprintChat()
const pendingMoves = usePendingMoves()

onMounted(() => void store.hydrate())

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
        <Badge variant="secondary" data-testid="workspace-source">
          {{ store.source === 'api' ? 'live' : 'offline' }}
        </Badge>
      </div>
      <p class="text-muted-foreground text-sm">{{ store.activeSprint?.goal }}</p>
    </header>
    <SprintStatsCards :stats="store.stats" />
    <Separator />
    <IssueBoard
      :issues="store.sprintIssues"
      :backlog="store.backlogIssues"
      :users="store.users"
      :pending-moves="pendingMoves"
      :changed="store.recentlyChanged"
    />
  </section>
</template>
