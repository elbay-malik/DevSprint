import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type CreateIssueInput,
  type ListIssuesInput,
  type SearchIssuesInput,
  type UpdateIssueStatusInput,
  type WorkspaceApi,
  TOOL_DESCRIPTIONS,
  createIssueInputSchema,
  listIssuesInputSchema,
  searchIssuesInputSchema,
  updateIssueStatusInputSchema,
} from '@devsprint/shared/tools'

/**
 * The four issue tools this server exposes (docs/tool-inventory.md, "Future MCP
 * server" column). Descriptions and input schemas are the same objects the
 * in-app agent uses, so the contract cannot drift between the two clients.
 *
 * `create_issue` and `update_issue_status` are writes, and they carry no
 * approval flag here on purpose: over MCP the host runs its own tool-permission
 * prompt, which replaces our ApprovalCard (docs/tool-inventory.md §3.6). What
 * does not change is server-side validation — the schema below runs on every
 * call regardless of what the host allowed.
 */
/**
 * Each entry calls its method on the workspace rather than naming it, so the
 * receiver is never lost. `workspace` is a Durable Object stub in production,
 * and pulling a method off a stub to call it standalone is the kind of thing
 * that works until it does not.
 */
const ISSUE_TOOLS = [
  {
    name: 'list_issues',
    schema: listIssuesInputSchema,
    invoke: (workspace: WorkspaceApi, input: ListIssuesInput) => workspace.listIssues(input),
  },
  {
    name: 'search_issues',
    schema: searchIssuesInputSchema,
    invoke: (workspace: WorkspaceApi, input: SearchIssuesInput) => workspace.searchIssues(input),
  },
  {
    name: 'create_issue',
    schema: createIssueInputSchema,
    invoke: (workspace: WorkspaceApi, input: CreateIssueInput) => workspace.createIssue(input),
  },
  {
    name: 'update_issue_status',
    schema: updateIssueStatusInputSchema,
    invoke: (workspace: WorkspaceApi, input: UpdateIssueStatusInput) =>
      workspace.updateIssueStatus(input),
  },
] as const

export const ISSUE_TOOL_NAMES = ISSUE_TOOLS.map((tool) => tool.name)

function envelope(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

export function registerIssueTools(server: McpServer, workspace: WorkspaceApi): void {
  for (const tool of ISSUE_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: TOOL_DESCRIPTIONS[tool.name],
        inputSchema: tool.schema.shape,
      },
      async (input: unknown) => {
        // The MCP SDK already checks arguments against the registered schema,
        // so this parse is the belt to that pair of braces — and it is what
        // applies the schema's defaults. The host decides whether the user
        // allows a call; it never decides whether the arguments are legal.
        const parsed = tool.schema.safeParse(input)
        if (!parsed.success) {
          return envelope({
            ok: false,
            error: { code: 'INVALID_INPUT', message: parsed.error.message },
          })
        }

        // The shared `{ ok, data | error }` envelope travels as the text
        // content, so a domain failure stays a value the caller can read
        // instead of becoming a protocol error (docs/domain-model.md §4).
        const invoke = tool.invoke as (workspace: WorkspaceApi, input: unknown) => Promise<unknown>
        return envelope(await invoke(workspace, parsed.data))
      },
    )
  }
}
