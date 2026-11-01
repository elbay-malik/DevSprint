import { readRequestBody } from '@modelcontextprotocol/sdk/server/requestBody.js'

/**
 * The largest body `/mcp` will read. The costliest legitimate call is
 * `create_issue` at every schema limit, under 30 KB even with each character
 * JSON-escaped, so this leaves room without letting one request hold a large
 * string in the isolate.
 */
export const MAX_BODY_BYTES = 64 * 1024

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
 * one. Anything but a POST has no body to check and goes through untouched.
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

function jsonRpcError(code: number, message: string, status = 400): Response {
  return Response.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status })
}
