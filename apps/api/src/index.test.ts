import { describe, expect, it } from 'vitest'
import type { Workspace } from '@devsprint/shared'
import app from './index'

const env = { CORS_ORIGIN: 'http://localhost:5173', MODEL_PROVIDER: 'mock' }

function ask(text: string, overrides: Record<string, string> = {}) {
  return app.request(
    '/api/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }],
      }),
    },
    { ...env, ...overrides },
  )
}

/** Parses a UI message stream body into its `data:` chunks (dropping `[DONE]`). */
function parseChunks(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => JSON.parse(payload) as Record<string, unknown>)
}

function textOf(chunks: Array<Record<string, unknown>>): string {
  return chunks
    .filter((chunk) => chunk.type === 'text-delta')
    .map((chunk) => String(chunk.delta))
    .join('')
}

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const res = await app.request('/api/health', {}, env)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })
})

describe('GET /api/workspace', () => {
  it('serves the seed workspace the tools read', async () => {
    const res = await app.request('/api/workspace', {}, env)
    expect(res.status).toBe(200)
    const workspace: Workspace = await res.json()
    expect(workspace.issues).toHaveLength(13)
    expect(workspace.now).toBe('2026-07-01T09:00:00Z')
  })

  it('allows the configured browser origin', async () => {
    const res = await app.request(
      '/api/workspace',
      { headers: { Origin: 'http://localhost:5173' } },
      env,
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })
})

describe('POST /api/chat', () => {
  it('answers the acceptance question with a grounded tool call', async () => {
    const res = await ask('How many open issues are in the current sprint?')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/)
    expect(res.headers.get('x-devsprint-model')).toBe('mock')

    const chunks = parseChunks(await res.text())
    const call = chunks.find((chunk) => chunk.type === 'tool-input-available')
    expect(call?.toolName).toBe('get_sprint_status')

    const output = chunks.find((chunk) => chunk.type === 'tool-output-available')?.output as {
      ok: boolean
      data: { stats: { remainingPoints: number; committedPoints: number } }
    }
    expect(output.ok).toBe(true)
    expect(output.data.stats.remainingPoints).toBe(23)
    expect(output.data.stats.committedPoints).toBe(31)

    const answer = textOf(chunks)
    expect(answer).toContain('5 open')
    expect(answer).toContain('DS-11')
  })

  it('streams the answer in more than one delta', async () => {
    const chunks = parseChunks(await (await ask('How is the sprint going?')).text())
    expect(chunks.filter((chunk) => chunk.type === 'text-delta').length).toBeGreaterThan(1)
  })

  it('exposes the model route header to the browser', async () => {
    const res = await ask('How is the sprint going?')
    expect(res.headers.get('access-control-expose-headers')).toContain('X-DevSprint-Model')
  })

  it('rejects a body without messages', async () => {
    const res = await app.request(
      '/api/chat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      env,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'INVALID_INPUT' } })
  })

  it('rejects a non-JSON body', async () => {
    const res = await app.request(
      '/api/chat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('rejects messages that are not valid UI messages', async () => {
    const res = await app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user' }] }),
      },
      env,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'INVALID_INPUT' } })
  })

  it('reports a provider that was requested without its key', async () => {
    const res = await ask('How is the sprint going?', { MODEL_PROVIDER: 'groq' })
    expect(res.status).toBe(503)
    const body: { error: { code: string; message: string } } = await res.json()
    expect(body.error.code).toBe('MODEL_NOT_CONFIGURED')
    expect(body.error.message).toContain('GROQ_API_KEY')
  })
})
