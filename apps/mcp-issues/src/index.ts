import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { registerIssueTools } from './tools'
import { workspaceOf } from './workspace'

/**
 * The publicly exposed issues MCP server (ADR-0002). An external host such as
 * Claude Desktop adds this URL as a remote server and gets the four issue
 * tools; `apps/api` connects to the same endpoint as an MCP client. Both drive
 * one workspace, which is what scenario S-F is there to prove.
 *
 * Stateless on purpose: a fresh server and transport per request, and no
 * session id generator. Cloudflare's current guidance is to build stateless
 * Streamable HTTP servers rather than session-backed ones. The only Durable
 * Object involved is the workspace itself, which is a different thing — keeping
 * those two ideas apart is what stops this server growing session state it does
 * not need.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ ok: true })
    }
    if (url.pathname !== '/mcp') {
      return new Response('Not found', { status: 404 })
    }

    const server = new McpServer({ name: 'devsprint-issues', version: '1.0.0' })
    registerIssueTools(server, workspaceOf(env.WORKSPACE))

    // No session id generator: stateless, so any request can be served by any
    // isolate without shared session state.
    const transport = new WebStandardStreamableHTTPServerTransport()
    await server.connect(transport)
    return await transport.handleRequest(request)
  },
}
