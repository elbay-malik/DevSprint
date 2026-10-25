import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import { computeSprintStats } from '@/features/workspace/lib/sprint-stats'
import { WORKSPACE_ENDPOINT } from '@/lib/api'

export type WorkspaceSource = 'seed' | 'api'

/** How long a card that just changed status stays marked; main.css animates it. */
export const CHANGE_HIGHLIGHT_MS = 1500

/** Keys of the issues whose status differs between two reads of the board. */
export function changedStatusKeys(previous: Workspace, next: Workspace): Set<string> {
  const before = new Map(previous.issues.map((issue) => [issue.key, issue.status]))
  return new Set(
    next.issues
      .filter((issue) => before.has(issue.key) && before.get(issue.key) !== issue.status)
      .map((issue) => issue.key),
  )
}

/**
 * Workspace state. Starts from the shared seed so the board renders instantly
 * (and keeps working while the api Worker is down), then `hydrate()` swaps in
 * the Worker's copy — the same board the agent's tools read, which lives in a
 * Durable Object rather than in any one isolate's memory (ADR-0011). Approved
 * writes land there and show up here on the next hydrate, whether they came
 * from this SPA or from an external MCP host. The pane hydrates when a turn
 * settles and when the reader comes back to the tab (useReadOnReturn); it
 * does not poll.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const workspace = ref<Workspace>(createWorkspaceSeed())
  const source = ref<WorkspaceSource>('seed')
  const hydrating = ref(false)
  /** When the Worker last answered a read (epoch ms); undefined until it has. */
  const readAt = ref<number>()
  /**
   * Issues whose status the last read changed, marked on the board for
   * CHANGE_HIGHLIGHT_MS so an approved move is seen landing rather than found.
   */
  const recentlyChanged = ref<ReadonlySet<string>>(new Set())
  let warned = false
  let clearChanged: ReturnType<typeof setTimeout> | undefined

  function markChanged(keys: ReadonlySet<string>): void {
    // A read that moved nothing is no news, and must not cut short a mark
    // still on screen from the read before; its own timer lets it go.
    if (keys.size === 0) return
    clearTimeout(clearChanged)
    recentlyChanged.value = keys
    clearChanged = setTimeout(() => {
      recentlyChanged.value = new Set()
    }, CHANGE_HIGHLIGHT_MS)
  }

  async function hydrate(): Promise<void> {
    hydrating.value = true
    try {
      const response = await fetch(WORKSPACE_ENDPOINT)
      if (!response.ok) throw new Error(`GET ${WORKSPACE_ENDPOINT} responded ${response.status}`)
      const next = (await response.json()) as Workspace
      // Only a change between two reads of the Worker is news. The first read
      // replaces the seed, and whatever differs there was never shown as live.
      if (source.value === 'api') markChanged(changedStatusKeys(workspace.value, next))
      workspace.value = next
      source.value = 'api'
      readAt.value = Date.now()
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
  const stats = computed(() =>
    computeSprintStats(sprintIssues.value, activeSprint.value, workspace.value.now),
  )
  const users = computed(() => workspace.value.users)

  return {
    workspace,
    source,
    hydrating,
    readAt,
    hydrate,
    recentlyChanged,
    activeSprint,
    sprintIssues,
    backlogIssues,
    stats,
    users,
  }
})
