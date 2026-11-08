import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { IssueSource } from '@devsprint/shared'
import type { WorkspaceApi } from '@devsprint/shared/tools'
import { MAX_BODY_BYTES } from './batch'
import { registerIssueTools } from './tools'

/**
 * The most array elements and object members one tool call's arguments may hold.
 * The costliest legitimate call, `create_issue`, has about 20. The SDK counts
 * before the schema runs, so a huge array never gets as far as zod.
 */
export const MAX_TOOL_INPUT_ELEMENTS = 100

/**
 * Answers one MCP request with a fresh server and transport. There is no session
 * id generator: stateless, so any request can be served by any isolate without
 * shared session state.
 *
 * `source` is the entrypoint's, passed on to the tools (see `registerIssueTools`).
 * `parsedBody` is what the public entrypoint already read and bounded. Without
 * it the transport reads the body itself, under the same limit.
 */
export async function handleMcpRequest(
  request: Request,
  workspace: WorkspaceApi,
  source: IssueSource,
  parsedBody?: unknown,
): Promise<Response> {
  const server = new McpServer(
    { name: 'devsprint-issues', version: '1.0.0' },
    { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS },
  )
  registerIssueTools(server, workspace, source)

  const transport = new WebStandardStreamableHTTPServerTransport({
    maxRequestBodySize: MAX_BODY_BYTES,
  })
  await server.connect(transport)
  return await transport.handleRequest(
    request,
    parsedBody === undefined ? undefined : { parsedBody },
  )
}
