import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { MAX_BODY_BYTES } from './batch'
import worker from './index'

/** The two bindings the public handler reads, with only the write these tests reach. */
function fakeEnv({ underLimit = true } = {}) {
  const issue = createWorkspaceSeed().issues[0]!
  const createIssue = vi.fn(() => Promise.resolve({ ok: true as const, data: { issue } }))
  const limit = vi.fn(() => Promise.resolve({ success: underLimit }))
  const env = {
    WORKSPACE: { idFromName: () => 'workspace', get: () => ({ createIssue }) },
    MCP_RATE_LIMIT: { limit },
  } as unknown as Env
  return { env, createIssue, limit }
}

function post(body: string) {
  return new Request('https://mcp.test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'CF-Connecting-IP': '203.0.113.9',
    },
    body,
  })
}

const call = (id: number, args: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'create_issue', arguments: { title: `t${id}`, type: 'bug', ...args } },
})

describe('the public fetch handler', () => {
  it('runs a single message on the body it already read, for one token', async () => {
    const { env, createIssue, limit } = fakeEnv()

    const response = await worker.fetch(post(JSON.stringify(call(1))), env)

    expect(response.status).toBe(200)
    await response.text()
    expect(createIssue).toHaveBeenCalledOnce()
    expect(limit).toHaveBeenCalledOnce()
  })

  it('refuses a batch before any call in it reaches the workspace', async () => {
    const { env, createIssue, limit } = fakeEnv()

    const response = await worker.fetch(post(JSON.stringify([call(1), call(2), call(3)])), env)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ id: null, error: { code: -32600 } })
    expect(createIssue).not.toHaveBeenCalled()
    expect(limit).toHaveBeenCalledOnce()
  })

  it('answers an over-limit body itself, after the rate limit, with no workspace call', async () => {
    const { env, createIssue, limit } = fakeEnv()
    const description = 'x'.repeat(MAX_BODY_BYTES)

    const response = await worker.fetch(post(JSON.stringify(call(1, { description }))), env)

    expect(response.status).toBe(413)
    // The transport has a 413 of its own with different wording, for the Internal path.
    await expect(response.json()).resolves.toMatchObject({
      error: { code: -32000, message: 'Payload too large.' },
    })
    expect(createIssue).not.toHaveBeenCalled()
    expect(limit).toHaveBeenCalledOnce()
  })

  it('throttles before it reads the body', async () => {
    const { env, createIssue } = fakeEnv({ underLimit: false })
    const request = post(JSON.stringify(call(1)))

    const response = await worker.fetch(request, env)

    expect(response.status).toBe(429)
    expect(request.bodyUsed).toBe(false)
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('spends no token on anything but /mcp', async () => {
    const { env, limit } = fakeEnv()

    const request = new Request('https://mcp.test/health', {
      headers: { 'CF-Connecting-IP': '203.0.113.9' },
    })

    const response = await worker.fetch(request, env)

    expect(response.status).toBe(200)
    expect(limit).not.toHaveBeenCalled()
  })
})
