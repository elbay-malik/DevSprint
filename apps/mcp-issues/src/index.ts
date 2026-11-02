import { WorkerEntrypoint } from 'cloudflare:workers'
import { refuseBatch, refuseForeignOrigin, refuseNonPost } from './batch'
import { refuseIfThrottled } from './limit'
import { handleMcpRequest } from './mcp'
import { workspaceOf } from './workspace'

/**
 * The publicly exposed issues MCP server (ADR-0002). An external host such as
 * Claude Desktop adds this URL as a remote server and gets the five issue
 * tools. It drives the same workspace the SPA shows, which is what scenario S-F
 * is there to prove. The in-app agent sources those same five tools from this
 * endpoint through an MCP client, so both clients drive one implementation
 * rather than two that drift.
 *
 * Stateless on purpose: a fresh server and transport per request, and no
 * session id generator. Cloudflare's current guidance is to build stateless
 * Streamable HTTP servers rather than session-backed ones. The only Durable
 * Object involved is the workspace itself, which is a different thing — keeping
 * those two ideas apart is what stops this server growing session state it does
 * not need.
 */
async function serve(request: Request, env: Env, parsedBody?: unknown): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/health') {
    return Response.json({ ok: true })
  }
  if (url.pathname !== '/mcp') {
    return new Response('Not found', { status: 404 })
  }
  const refused = refuseNonPost(request)
  if (refused) return refused

  return await handleMcpRequest(request, workspaceOf(env.WORKSPACE), parsedBody)
}

/** The public endpoint: external MCP hosts, throttled per client IP (ADR-0020). */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== '/mcp') return await serve(request, env)

    const foreign = refuseForeignOrigin(request)
    if (foreign) return foreign
    const refused = await refuseIfThrottled(request, env.MCP_RATE_LIMIT)
    if (refused) return refused
    const body = await refuseBatch(request)
    if ('refused' in body) return body.refused
    return await serve(request, env, body.parsedBody)
  },
} satisfies ExportedHandler<Env>

/**
 * The in-app agent's way in. apps/api's service binding names this entrypoint,
 * so its traffic never shares the public limit: a binding request carries no
 * client IP, and lumping every visitor's turns into one bucket would let the
 * demo throttle itself. It is not reachable from the internet — only a binding
 * in this account can name it.
 */
export class Internal extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    return await serve(request, this.env)
  }
}
