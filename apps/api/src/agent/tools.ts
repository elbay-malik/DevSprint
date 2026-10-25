/**
 * The agent's tools. Descriptions and input schemas come verbatim from
 * `@devsprint/shared/tools`; execution delegates to the pure functions over the
 * store's current snapshot.
 *
 * Reads (1–6) execute on sight. Writes (7–9, 11) carry `needsApproval: true`, which
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
import type { WorkspaceApi } from '@devsprint/shared/tools'
import { runDeployment } from './deployment'

export function createReadTools(workspace: WorkspaceApi) {
  return {
    list_issues: tool({
      description: TOOL_DESCRIPTIONS.list_issues,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.list_issues,
      execute: (input) => workspace.listIssues(input),
    }),
    search_issues: tool({
      description: TOOL_DESCRIPTIONS.search_issues,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.search_issues,
      execute: (input) => workspace.searchIssues(input),
    }),
    get_sprint_status: tool({
      description: TOOL_DESCRIPTIONS.get_sprint_status,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.get_sprint_status,
      execute: (input) => workspace.getSprintStatus(input),
    }),
    get_deployment_history: tool({
      description: TOOL_DESCRIPTIONS.get_deployment_history,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.get_deployment_history,
      execute: (input) => workspace.getDeploymentHistory(input),
    }),
    get_burndown: tool({
      description: TOOL_DESCRIPTIONS.get_burndown,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.get_burndown,
      execute: (input) => workspace.getBurndown(input),
    }),
    diff_release_notes: tool({
      description: TOOL_DESCRIPTIONS.diff_release_notes,
      inputSchema: READ_TOOL_INPUT_SCHEMAS.diff_release_notes,
      execute: (input) => workspace.diffReleaseNotes(input),
    }),
  } satisfies Record<ReadToolName, Tool>
}

export interface WriteToolOptions {
  /** Lets a cancelled deployment finish recording itself after the client leaves. */
  waitUntil?: (promise: Promise<unknown>) => void
}

export function createWriteTools(workspace: WorkspaceApi, options: WriteToolOptions = {}) {
  return {
    create_issue: tool({
      description: TOOL_DESCRIPTIONS.create_issue,
      inputSchema: WRITE_TOOL_INPUT_SCHEMAS.create_issue,
      needsApproval: true,
      execute: (input) => workspace.createIssue(input),
    }),
    update_issue_status: tool({
      description: TOOL_DESCRIPTIONS.update_issue_status,
      inputSchema: WRITE_TOOL_INPUT_SCHEMAS.update_issue_status,
      needsApproval: true,
      execute: (input) => workspace.updateIssueStatus(input),
    }),
    assign_issue: tool({
      description: TOOL_DESCRIPTIONS.assign_issue,
      inputSchema: WRITE_TOOL_INPUT_SCHEMAS.assign_issue,
      needsApproval: true,
      execute: (input) => workspace.assignIssue(input),
    }),
    create_release_notes: tool({
      description: TOOL_DESCRIPTIONS.create_release_notes,
      inputSchema: WRITE_TOOL_INPUT_SCHEMAS.create_release_notes,
      needsApproval: true,
      execute: (input) => workspace.createReleaseNotes(input),
    }),
    run_deployment: tool({
      description: TOOL_DESCRIPTIONS.run_deployment,
      inputSchema: WRITE_TOOL_INPUT_SCHEMAS.run_deployment,
      needsApproval: true,
      // An async generator: every yield reaches the client as a preliminary
      // result, which is what makes the progress card move.
      //
      // The abort signal is a backstop, not the Cancel button. Cancel is an api
      // route, because a client that stops reading the stream does not reliably
      // abort this request — see ADR-0013.
      execute: (input, { abortSignal }) =>
        runDeployment({
          workspace,
          input,
          ...(abortSignal ? { abortSignal } : {}),
          ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
        }),
    }),
  } satisfies Record<WriteToolName, Tool>
}

export function createTools(workspace: WorkspaceApi, options: WriteToolOptions = {}) {
  return { ...createReadTools(workspace), ...createWriteTools(workspace, options) }
}

/**
 * The tools the issues MCP server owns, so callers can drop the local copies
 * when the agent sources them over MCP instead (ADR-0002).
 */
export const MCP_OWNED_TOOL_NAMES = [
  'list_issues',
  'search_issues',
  'create_issue',
  'update_issue_status',
  'assign_issue',
] as const

export type ReadTools = ReturnType<typeof createReadTools>
export type DevSprintTools = ReturnType<typeof createTools>
