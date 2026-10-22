import { describe, expect, it, vi } from 'vitest'
import { refuseIfThrottled, type RateLimitBinding } from './limit'

function request(ip?: string): Request {
  return new Request('https://devsprint-mcp-issues.example.workers.dev/mcp', {
    method: 'POST',
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  })
}

function limiter(success: boolean): RateLimitBinding & { limit: ReturnType<typeof vi.fn> } {
  return { limit: vi.fn(() => Promise.resolve({ success })) }
}

describe('refuseIfThrottled', () => {
  it('lets a request under the limit through, keyed by its client IP', async () => {
    const binding = limiter(true)
    expect(await refuseIfThrottled(request('203.0.113.9'), binding)).toBeUndefined()
    expect(binding.limit).toHaveBeenCalledWith({ key: '203.0.113.9' })
  })

  it('refuses a throttled client as a readable JSON-RPC error with a 429', async () => {
    const refused = await refuseIfThrottled(request('203.0.113.9'), limiter(false))
    expect(refused?.status).toBe(429)
    expect(refused?.headers.get('Retry-After')).toBe('60')
    const body = (await refused?.json()) as { jsonrpc: string; error: { message: string } }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.error.message).toMatch(/Too many requests/)
  })

  it('never puts clients without an IP into one shared bucket', async () => {
    // A shared key would let one abuser lock everyone else out.
    const binding = limiter(false)
    expect(await refuseIfThrottled(request(), binding)).toBeUndefined()
    expect(binding.limit).not.toHaveBeenCalled()
  })

  it('does nothing where no limiter is bound', async () => {
    expect(await refuseIfThrottled(request('203.0.113.9'), undefined)).toBeUndefined()
  })
})
