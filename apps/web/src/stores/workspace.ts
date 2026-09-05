import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import { computeSprintStats } from '@/features/workspace/lib/sprint-stats'
import { WORKSPACE_ENDPOINT } from '@/lib/api'

export type WorkspaceSource = 'seed' | 'api'

/**
 * Workspace state. Starts from the shared seed so the board renders instantly
 * (and keeps working while the api Worker is down), then `hydrate()` swaps in
 * the Worker's copy — the same in-memory workspace the agent's tools read.
 * From Phase 5 on, approved writes land in the Worker and show up here on the
 * next hydrate; Phase 9 moves the source of truth to D1.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const workspace = ref<Workspace>(createWorkspaceSeed())
  const source = ref<WorkspaceSource>('seed')
  const hydrating = ref(false)
  let warned = false

  async function hydrate(): Promise<void> {
    hydrating.value = true
    try {
      const response = await fetch(WORKSPACE_ENDPOINT)
      if (!response.ok) throw new Error(`GET ${WORKSPACE_ENDPOINT} responded ${response.status}`)
      workspace.value = (await response.json()) as Workspace
      source.value = 'api'
    } catch (error) {
      // Expected whenever the Worker is not running locally: fall back to the
      // seed and warn once instead of toasting on every retry. The reset is
      // what keeps `source` honest — the pane re-hydrates on every mount, so a
      // refresh that fails after an earlier success would otherwise leave the
      // board showing the Worker's data under a "seed data" badge.
      workspace.value = createWorkspaceSeed()
      source.value = 'seed'
      if (!warned) {
        warned = true
        console.warn('[workspace] api unreachable, showing seed data:', error)
      }
    } finally {
      hydrating.value = false
    }
  }

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

  return {
    workspace,
    source,
    hydrating,
    hydrate,
    activeSprint,
    sprintIssues,
    backlogIssues,
    stats,
    users,
  }
})
