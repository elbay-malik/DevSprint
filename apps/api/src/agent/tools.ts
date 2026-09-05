/**
 * The agent's tools. Descriptions and input schemas come verbatim from
 * `@devsprint/shared/tools`; execution delegates to the pure functions over the
 * store's current snapshot.
 *
 * Reads (1–6) execute on sight. Writes (7–9) carry `needsApproval: true`, which
 * is what makes the SDK pause and ask a human before running them — every write
 * is gated, with no allowlist and no "trusted after the first one" mode
 * (docs/tool-inventory.md §3, ADR-0003). Omitting the flag would silently make a
 * tool auto-execute, which is why tools.test.ts asserts it on every write.
 *
 * `run_deployment` (10) is the long-running write and arrives with its
 * simulation in Phase 8.
 */
import { tool, type Tool } from 'ai'
import {
  READ_TOOL_INPUT_SCHEMAS,
  TOOL_DESCRIPTIONS,
  WRITE_TOOL_INPUT_SCHEMAS,
  type ReadToolName,
  type WriteToolName,
} from '@devsprint/shared/tools'
import type { WorkspaceStore } from '../workspace/store'
import {
  diffReleaseNotes,
  getBurndown,
  getDeploymentHistory,
  getSprintStatus,
  listIssues,
  searchIssues,
} from '../workspace/queries'
import { createIssue, createReleaseNotes, updateIssueStatus } from '../workspace/mutations'

export function createReadTools(store: WorkspaceStore) {
  return {
    list_issues: tool({
      description: TOOL_DESCRIPTIONS.list_issues,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.list_issues,
      execute: (input) => listIssues(store.get(), input),
    }),
    search_issues: tool({
      description: TOOL_DESCRIPTIONS.search_issues,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.search_issues,
      execute: (input) => searchIssues(store.get(), input),
    }),
    get_sprint_status: tool({
      description: TOOL_DESCRIPTIONS.get_sprint_status,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.get_sprint_status,
      execute: (input) => getSprintStatus(store.get(), input),
    }),
    get_deployment_history: tool({
      description: TOOL_DESCRIPTIONS.get_deployment_history,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.get_deployment_history,
      execute: (input) => getDeploymentHistory(store.get(), input),
    }),
    get_burndown: tool({
      description: TOOL_DESCRIPTIONS.get_burndown,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.get_burndown,
      execute: (input) => getBurndown(store.get(), input),
    }),
    diff_release_notes: tool({
      description: TOOL_DESCRIPTIONS.diff_release_notes,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.diff_release_notes,
      execute: (input) => diffReleaseNotes(store.get(), input),
    }),
  } satisfies Record<ReadToolName, Tool>
}

export function createWriteTools(store: WorkspaceStore) {
  return {
    create_issue: tool({
      description: TOOL_DESCRIPTIONS.create_issue,
      inputSchema: WRITE_TOOL_INPUT_SCHEMAS.create_issue,
      needsApproval: true,
      execute: (input) => createIssue(store.get(), input),
    }),
    update_issue_status: tool({
      description: TOOL_DESCRIPTIONS.update_issue_status,
      inputSchema: WRITE_TOOL_INPUT_SCHEMAS.update_issue_status,
      needsApproval: true,
      execute: (input) => updateIssueStatus(store.get(), input),
    }),
    create_release_notes: tool({
      description: TOOL_DESCRIPTIONS.create_release_notes,
      inputSchema: WRITE_TOOL_INPUT_SCHEMAS.create_release_notes,
      needsApproval: true,
      execute: (input) => createReleaseNotes(store.get(), input),
    }),
  } satisfies Record<WriteToolName, Tool>
}

export function createTools(store: WorkspaceStore) {
  return { ...createReadTools(store), ...createWriteTools(store) }
}

export type ReadTools = ReturnType<typeof createReadTools>
export type DevSprintTools = ReturnType<typeof createTools>
