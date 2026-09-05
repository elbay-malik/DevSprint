<script setup lang="ts">
import { onMounted } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useWorkspaceStore } from '@/stores/workspace'
import IssueBoard from './IssueBoard.vue'
import SprintStatsCards from './SprintStatsCards.vue'

const store = useWorkspaceStore()

onMounted(() => void store.hydrate())
</script>

<template>
  <section
    data-testid="workspace-pane"
    class="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-6"
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
