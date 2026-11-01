import { readRequestBody } from '@modelcontextprotocol/sdk/server/requestBody.js'

/**
 * The largest body `/mcp` will read. The costliest legitimate call is
 * `create_issue` at every schema limit, under 30 KB even with each character
 * JSON-escaped, so this leaves room without letting one request hold a large
 * string in the isolate.
 */
export const MAX_BODY_BYTES = 64 * 1024

/**
 * Refuses every method but POST on `/mcp`, on both entrypoints.
 *
 * A GET would otherwise open the SDK's server-to-client stream, which this
 * server never writes to: it is stateless, so nothing outlives a request. The
 * stream only sends keepalives, and it holds an isolate for as long as the
 * client leaves it open, for the price of one rate-limit token. The spec lets a
 * server answer 405 to say it offers no such stream, and both MCP clients we
 * use take that as normal. A DELETE ends a session, and there are none to end.
 */
export function refuseNonPost(request: Request): Response | undefined {
  if (request.method === 'POST') return undefined
  return jsonRpcError(-32000, 'Method not allowed.', 405, { Allow: 'POST' })
}

/**
 * Refuses a JSON-RPC batch or an oversized body on the public endpoint
 * (ADR-0024).
 *
 * The rate limit spends one token per HTTP request, and the SDK dispatches
 * every element of an array body, so one throttled request could carry a
 * hundred `create_issue` calls and the limit meant nothing. The MCP spec
 * dropped batching in 2025-06-18, so no host relies on it.
 *
 * The body is parsed once here and handed back for the transport, because a
 * request body can only be read once. The transport skips its own size limit
 * for a body it is handed, so the read is bounded here. A declared
 * Content-Length isn't enough, because a chunked request doesn't have to send
 * one. Anything but a POST has no body to check, and `refuseNonPost` answers it.
 */
export async function refuseBatch(
  request: Request,
): Promise<{ refused: Response } | { parsedBody: unknown }> {
  if (request.method !== 'POST') return { parsedBody: undefined }
  let parsedBody: unknown
  try {
    const body = await readRequestBody(request, MAX_BODY_BYTES)
    if (body.tooLarge) return { refused: jsonRpcError(-32000, 'Payload too large.', 413) }
    parsedBody = JSON.parse(body.text)
  } catch {
    return { refused: jsonRpcError(-32700, 'Parse error: the body must be JSON.') }
  }
  if (Array.isArray(parsedBody)) {
    return {
      refused: jsonRpcError(
        -32600,
        'Batched requests are not supported. Send one JSON-RPC message per request.',
      ),
    }
  }
  return { parsedBody }
}

function jsonRpcError(
  code: number,
  message: string,
  status = 400,
  headers: Record<string, string> = {},
): Response {
  return Response.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers })
}
