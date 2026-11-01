import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import { computeSprintStats } from '@/features/workspace/lib/sprint-stats'
import { WORKSPACE_ENDPOINT } from '@/lib/api'

export type WorkspaceSource = 'seed' | 'api'

/** How long a card that just changed stays marked; main.css animates it. */
export const CHANGE_HIGHLIGHT_MS = 1500

/**
 * Keys of the issues that are new, or whose status or assignee differs, between
 * two reads of the board: the things a write can do to a card that a reader
 * would want to see land. An issue the next read no longer holds has no card to
 * mark.
 */
export function changedIssueKeys(previous: Workspace, next: Workspace): Set<string> {
  const before = new Map(previous.issues.map((issue) => [issue.key, issue]))
  return new Set(
    next.issues
      .filter((issue) => {
        const was = before.get(issue.key)
        return (
          was === undefined || was.status !== issue.status || was.assigneeId !== issue.assigneeId
        )
      })
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
 *
 * A failed read after a good one keeps the board it had and says it is
 * offline. A laptop waking fires `visibilitychange` before the network is
 * back, and swapping the live board for the seed then would turn an open
 * card for an issue made over MCP into "DS-14 isn't on the board".
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const seed = createWorkspaceSeed()
  const workspace = ref<Workspace>(createWorkspaceSeed())
  const source = ref<WorkspaceSource>('seed')
  const hydrating = ref(false)
  /** The last read failed; the board shown is the seed or the last good read. */
  const offline = ref(false)
  /** When the Worker last answered a read (epoch ms); undefined until it has. */
  const readAt = ref<number>()
  /**
   * Issues the last read added, moved or handed on, marked on the board for
   * CHANGE_HIGHLIGHT_MS so an approved change is seen landing rather than found.
   */
  const recentlyChanged = ref<ReadonlySet<string>>(new Set())
  let warned = false
  /** Reads can overlap (a return, then a turn settling); only the latest may land. */
  let latestRead = 0
  let clearChanged: ReturnType<typeof setTimeout> | undefined

  function markChanged(keys: ReadonlySet<string>): void {
    // A read that changed nothing is no news, and must not cut short a mark
    // still on screen from the read before; its own timer lets it go.
    if (keys.size === 0) return
    clearTimeout(clearChanged)
    recentlyChanged.value = keys
    clearChanged = setTimeout(() => {
      recentlyChanged.value = new Set()
    }, CHANGE_HIGHLIGHT_MS)
  }

  async function hydrate(): Promise<void> {
    const read = ++latestRead
    hydrating.value = true
    try {
      const response = await fetch(WORKSPACE_ENDPOINT)
      if (!response.ok) throw new Error(`GET ${WORKSPACE_ENDPOINT} responded ${response.status}`)
      const next = (await response.json()) as Workspace
      // An older read answering last would put back a board the newer one
      // already replaced, and mark the moves it undid as changes.
      if (read !== latestRead) return
      // Only a change between two reads of the Worker is news. The first read
      // replaces the seed, and whatever differs there was never shown as live.
      if (source.value === 'api') markChanged(changedIssueKeys(workspace.value, next))
      workspace.value = next
      source.value = 'api'
      offline.value = false
      readAt.value = Date.now()
    } catch (error) {
      if (read !== latestRead) return
      // Expected whenever the Worker is not running locally: warn once instead
      // of toasting on every retry. Without a good read yet, the board is the
      // seed. After one, it stays as last read, which `source` and `readAt`
      // still describe, and `offline` says the read behind it is not current.
      offline.value = true
      if (!warned) {
        warned = true
        console.warn('[workspace] api unreachable, showing seed data:', error)
      }
    } finally {
      if (read === latestRead) hydrating.value = false
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
  /**
   * How far the board has come from the seed, counted by the same rule as the
   * changed-card mark. Client-side, since the Durable Object keeps no board-level
   * change time, and `Issue.updatedAt` is the board's frozen clock.
   */
  const changesSinceReset = computed(() => changedIssueKeys(seed, workspace.value).size)

  return {
    workspace,
    source,
    offline,
    hydrating,
    readAt,
    hydrate,
    recentlyChanged,
    activeSprint,
    sprintIssues,
    backlogIssues,
    stats,
    users,
    changesSinceReset,
  }
})
