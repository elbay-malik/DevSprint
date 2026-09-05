/**
 * The six read/rich-data tools (docs/tool-inventory.md 1–6) as plain AI SDK
 * function-calling tools. Descriptions and input schemas come verbatim from
 * `@devsprint/shared/tools`; execution delegates to the pure queries against
 * the store's current snapshot. Write tools (7–10) are deliberately absent —
 * they arrive with the Phase 5 approval gates and must never run ungated
 * (ADR-0003).
 */
import { tool, type Tool } from 'ai'
import {
  READ_TOOL_INPUT_SCHEMAS,
  TOOL_DESCRIPTIONS,
  type ReadToolName,
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

export type ReadTools = ReturnType<typeof createReadTools>
