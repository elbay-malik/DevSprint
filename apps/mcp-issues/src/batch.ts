/**
 * Refuses a JSON-RPC batch on the public endpoint (SECURITY_AUDIT.md, SEC-02).
 *
 * The rate limit spends one token per HTTP request, and the SDK dispatches
 * every element of an array body, so one throttled request could carry a
 * hundred `create_issue` calls and the limit meant nothing. The MCP spec
 * dropped batching in 2025-06-18, so no host relies on it.
 *
 * The body is parsed once here and handed back for the transport, because a
 * request body can only be read once. Anything but a POST has no body to
 * check and goes through untouched.
 */
export async function refuseBatch(
  request: Request,
): Promise<{ refused: Response } | { parsedBody: unknown }> {
  if (request.method !== 'POST') return { parsedBody: undefined }
  let parsedBody: unknown
  try {
    parsedBody = await request.json()
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

function jsonRpcError(code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status: 400 })
}
