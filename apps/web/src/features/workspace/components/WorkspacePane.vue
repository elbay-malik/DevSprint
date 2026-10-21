<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDevSprintChat } from '@/features/chat/composables/useDevSprintChat'
import IssueBoard from './IssueBoard.vue'
import SprintStatsCards from './SprintStatsCards.vue'

const store = useWorkspaceStore()
const chat = useDevSprintChat()

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
       stop a keyboard user could never reach the lower columns. -->
  <section
    data-testid="workspace-pane"
    tabindex="0"
    aria-label="Sprint board"
    class="focus-visible:ring-ring/50 flex min-h-0 flex-col gap-4 overflow-y-auto p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-inset lg:p-6"
  >
    <header>
      <div class="flex items-center gap-2">
        <p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {{ store.workspace.project.name }}
        </p>
        <Badge variant="secondary" data-testid="workspace-source">
          {{ store.source === 'api' ? 'live' : 'seed data' }}
        </Badge>
      </div>
      <h1 class="text-lg font-semibold">
        {{ store.activeSprint?.name ?? 'No active sprint' }}
      </h1>
      <p class="text-muted-foreground text-sm">{{ store.activeSprint?.goal }}</p>
    </header>
    <SprintStatsCards :stats="store.stats" />
    <Separator />
    <IssueBoard :issues="store.sprintIssues" :backlog="store.backlogIssues" :users="store.users" />
  </section>
</template>
