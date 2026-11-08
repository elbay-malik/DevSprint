import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createWorkspaceSeed } from '@devsprint/shared'
import { MAX_BODY_BYTES } from './batch'
import worker, { Internal } from './index'

/** The two bindings the public handler reads, with only the write these tests reach. */
function fakeEnv({ underLimit = true } = {}) {
  const issue = createWorkspaceSeed().issues[0]!
  const createIssue = vi.fn(() => Promise.resolve({ ok: true as const, data: { issue } }))
  const limit = vi.fn(() => Promise.resolve({ success: underLimit }))
  const openWorkspace = vi.fn(() => ({ createIssue }))
  const env = {
    WORKSPACE: { idFromName: () => 'workspace', get: openWorkspace },
    MCP_RATE_LIMIT: { limit },
  } as unknown as Env
  return { env, createIssue, limit, openWorkspace }
}

/** What a host sends to open the optional server-to-client stream. */
function openStream(method = 'GET') {
  return new Request('https://mcp.test/mcp', {
    method,
    headers: { Accept: 'text/event-stream', 'CF-Connecting-IP': '203.0.113.9' },
  })
}

function internal(env: Env) {
  return new Internal({} as ExecutionContext, env)
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

  it.each(['GET', 'DELETE'])('refuses a %s for one token, with no workspace', async (method) => {
    const { env, limit, openWorkspace } = fakeEnv()

    const response = await worker.fetch(openStream(method), env)

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(limit).toHaveBeenCalledOnce()
    expect(openWorkspace).not.toHaveBeenCalled()
  })

  it.each([
    'https://evil.example',
    'http://localhost.evil.example',
    'http://127.0.0.1.evil.example:8788',
    'null',
    'vscode-file://vscode-app',
  ])('refuses the origin %s before it spends a token or reads the body', async (origin) => {
    const { env, limit, createIssue } = fakeEnv()
    const request = post(JSON.stringify(call(1)))
    request.headers.set('Origin', origin)

    const response = await worker.fetch(request, env)

    expect(response.status).toBe(403)
    expect(limit).not.toHaveBeenCalled()
    expect(request.bodyUsed).toBe(false)
    expect(createIssue).not.toHaveBeenCalled()
  })

  it.each(['http://localhost:5173', 'http://127.0.0.1:8788', 'http://[::1]:8788'])(
    'lets the loopback origin %s through',
    async (origin) => {
      const { env, createIssue } = fakeEnv()
      const request = post(JSON.stringify(call(1)))
      request.headers.set('Origin', origin)

      const response = await worker.fetch(request, env)

      expect(response.status).toBe(200)
      await response.text()
      expect(createIssue).toHaveBeenCalledOnce()
    },
  )

  it('serves a real MCP client, which sends no Origin', async () => {
    const { env, createIssue } = fakeEnv()
    const origins: (string | null)[] = []
    const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        origins.push(request.headers.get('Origin'))
        return await worker.fetch(request, env)
      },
    })
    const client = new Client({ name: 'test-host', version: '1.0.0' })

    await client.connect(transport)
    await client.callTool({ name: 'create_issue', arguments: { title: 'a title', type: 'bug' } })
    await client.close()

    expect(origins.length).toBeGreaterThan(0)
    expect(new Set(origins)).toEqual(new Set([null]))
    expect(createIssue).toHaveBeenCalledOnce()
  })

  it('marks what it creates as coming from MCP', async () => {
    const { env, createIssue } = fakeEnv()

    const response = await worker.fetch(post(JSON.stringify(call(1))), env)
    await response.text()

    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({ title: 't1' }), 'mcp')
  })

  it('still answers a GET on /health', async () => {
    const { env } = fakeEnv()

    const response = await worker.fetch(new Request('https://mcp.test/health'), env)

    await expect(response.json()).resolves.toEqual({ ok: true })
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

describe('the Internal entrypoint', () => {
  it.each(['GET', 'DELETE'])('refuses a %s too, with no workspace', async (method) => {
    const { env, limit, openWorkspace } = fakeEnv()

    const response = await internal(env).fetch(openStream(method))

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(limit).not.toHaveBeenCalled()
    expect(openWorkspace).not.toHaveBeenCalled()
  })

  it('serves a real MCP client, which takes the 405 on its GET as normal', async () => {
    const { env, createIssue } = fakeEnv()
    const entrypoint = internal(env)
    const answers: { method: string; status: number }[] = []
    const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
      fetch: async (input, init) => {
        const response = await entrypoint.fetch(new Request(input, init))
        answers.push({ method: init?.method ?? 'GET', status: response.status })
        return response
      },
    })
    const client = new Client({ name: 'test-host', version: '1.0.0' })
    const onerror = vi.fn()
    client.onerror = onerror

    await client.connect(transport)
    const { tools } = await client.listTools()
    const result = await client.callTool({
      name: 'create_issue',
      arguments: { title: 'a title', type: 'bug' },
    })
    await client.close()

    expect(tools).toHaveLength(5)
    expect(result.isError).toBeUndefined()
    expect(createIssue).toHaveBeenCalledOnce()
    expect(answers).toContainEqual({ method: 'GET', status: 405 })
    expect(onerror).not.toHaveBeenCalled()
  })

  it('creates as the in-app copilot, not as an MCP client', async () => {
    const { env, createIssue } = fakeEnv()

    const response = await internal(env).fetch(post(JSON.stringify(call(1))))
    await response.text()

    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({ title: 't1' }), 'app')
  })
})
