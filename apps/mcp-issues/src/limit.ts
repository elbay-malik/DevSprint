/**
 * Per-IP throttling for the public endpoint (ADR-0020).
 *
 * The public server runs `create_issue` with no approval gate of ours (the host
 * owns that prompt), so one client looping it can fill the shared demo board to
 * its size cap and turn every visitor's writes into WORKSPACE_FULL until the
 * midnight reset. The cap bounds storage; this bounds how fast one client can
 * reach it.
 *
 * Same policy as the api's chat limit (ADR-0016): keyed on CF-Connecting-IP,
 * and skipped rather than shared when that is absent, because a shared bucket
 * would let one abusive client lock everyone else out. An IPv6 client is keyed
 * on its /64 (`ipRateLimitKey`).
 */
import { ipRateLimitKey } from '@devsprint/shared'

/** Cloudflare's rate-limit binding, as much of it as this Worker uses. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export const RETRY_AFTER_SECONDS = 60

/**
 * A refusal for a throttled request, or undefined to let it through. Shaped as
 * a JSON-RPC error so an MCP host can show the reason, with HTTP 429 and
 * Retry-After for anything that only reads the status.
 */
export async function refuseIfThrottled(
  request: Request,
  limiter: RateLimitBinding | undefined,
): Promise<Response | undefined> {
  if (!limiter) return undefined
  const ip = request.headers.get('cf-connecting-ip')?.trim()
  if (!ip) return undefined
  const { success } = await limiter.limit({ key: ipRateLimitKey(ip) })
  if (success) return undefined
  return Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: `Too many requests to the DevSprint demo's MCP server. Try again in ${RETRY_AFTER_SECONDS} seconds.`,
      },
    },
    { status: 429, headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) } },
  )
}
