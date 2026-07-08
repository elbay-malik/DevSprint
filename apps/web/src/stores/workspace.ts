import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import { computeSprintStats } from '@/features/workspace/lib/sprint-stats'

/**
 * Workspace state, seeded from the shared fixtures. This store is the seam
 * the Phase 3+ API integration replaces (fetching from the api Worker instead
 * of the static seed).
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const workspace = ref<Workspace>(createWorkspaceSeed())

  const activeSprint = computed(() =>
    workspace.value.sprints.find((sprint) => sprint.state === 'active'),
  )
  const sprintIssues = computed(() =>
    workspace.value.issues.filter((issue) => issue.sprintId === activeSprint.value?.id),
  )
  const backlogIssues = computed(() =>
    workspace.value.issues.filter((issue) => issue.sprintId === null),
  )
  const stats = computed(() => computeSprintStats(sprintIssues.value))
  const users = computed(() => workspace.value.users)

  return { workspace, activeSprint, sprintIssues, backlogIssues, stats, users }
})
