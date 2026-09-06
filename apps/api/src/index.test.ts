import { afterEach, describe, expect, it } from 'vitest'
import type { Workspace } from '@devsprint/shared'
import app from './index'
import { fakeWorkspaceBinding } from '../test/workspace-binding'

const workspace = fakeWorkspaceBinding()
const env = {
  CORS_ORIGIN: 'http://localhost:5173',
  MODEL_PROVIDER: 'mock',
  WORKSPACE: workspace.binding,
}

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

describe('POST /api/workspace/reset', () => {
  it('puts the board back to the seed after a write', async () => {
    const { updateIssueStatus } = await import('./workspace/mutations')
    updateIssueStatus(workspace.store.get(), { issueKey: 'DS-7', status: 'done' })
    expect(workspace.store.get().issues.find((i) => i.key === 'DS-7')?.status).toBe('done')

    const res = await app.request('/api/workspace/reset', { method: 'POST' }, env)

    expect(res.status).toBe(200)
    expect(workspace.store.get().issues.find((i) => i.key === 'DS-7')?.status).toBe('in_review')
  })
})

describe('POST /api/deployments/:id/cancel', () => {
  // These add a deployment the seed does not have, and the store is shared
  // across the file, so put it back rather than leaving it for later tests.
  afterEach(async () => {
    await app.request('/api/workspace/reset', { method: 'POST' }, env)
  })

  it('settles a running deployment as cancelled', async () => {
    const { startDeployment } = await import('./workspace/mutations')
    const started = startDeployment(workspace.store.get(), {
      environment: 'staging',
      version: 'v9.9.9',
      skipTests: false,
    })
    expect(started.ok).toBe(true)
    const id = started.ok ? started.data.deployment.id : ''

    const res = await app.request(`/api/deployments/${id}/cancel`, { method: 'POST' }, env)

    expect(res.status).toBe(200)
    const stored = workspace.store.get().deployments.find((d) => d.id === id)
    expect(stored?.status).toBe('cancelled')
    // Nothing is left mid-flight for the board to render as still going.
    expect(stored?.stages.some((stage) => stage.status === 'running')).toBe(false)
  })

  it('refuses to cancel a run that already finished', async () => {
    // dep-5 in the seed shipped v1.4.2 to production. Answering 200 here would
    // tell the user their cancel landed on a release that is already live.
    const res = await app.request('/api/deployments/dep-5/cancel', { method: 'POST' }, env)

    expect(res.status).toBe(409)
    const body: { ok: boolean; error: { code: string } } = await res.json()
    expect(body.error.code).toBe('DEPLOY_ALREADY_SETTLED')
    expect(workspace.store.get().deployments.find((d) => d.id === 'dep-5')?.status).toBe(
      'succeeded',
    )
  })

  it('says so rather than inventing a deployment to cancel', async () => {
    const res = await app.request('/api/deployments/dep-nope/cancel', { method: 'POST' }, env)

    expect(res.status).toBe(404)
    const body: { ok: boolean; error: { code: string } } = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_INPUT')
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

  it('exposes the model and tool-source headers to the browser', async () => {
    const res = await ask('How is the sprint going?')
    const exposed = res.headers.get('access-control-expose-headers')
    expect(exposed).toContain('X-DevSprint-Model')
    expect(exposed).toContain('X-DevSprint-Tools')
  })

  it('says which tool source it used rather than leaving it to be guessed', async () => {
    // No MCP binding in the unit env, so the agent falls back to local tools.
    // Reporting that is what stops a demo looking like it proved the MCP path.
    const res = await ask('How is the sprint going?')
    expect(res.headers.get('x-devsprint-tools')).toBe('local')
  })

  it('chains several tools in one turn and answers from all of them', async () => {
    const res = await ask('Summarize Sprint 12 and draft release notes for v1.5.0.')
    const chunks = parseChunks(await res.text())

    const calls = chunks
      .filter((chunk) => chunk.type === 'tool-input-available')
      .map((chunk) => chunk.toolName)
    expect(calls).toEqual(['get_sprint_status', 'list_issues'])

    // The second call is scoped by the first step's context, not a blind repeat.
    const listInput = chunks.find(
      (chunk) => chunk.type === 'tool-input-available' && chunk.toolName === 'list_issues',
    )?.input
    expect(listInput).toMatchObject({ sprintId: 'sprint-12', status: 'done' })

    // The answer is grounded in both results: sprint health and the shipped issues.
    const answer = textOf(chunks)
    expect(answer).toContain('23 of 31 points remaining')
    expect(answer).toContain('DS-5')
    expect(answer).toContain('DS-6')
  })

  it('aborting the request ends the agent loop instead of running it out', async () => {
    const controller = new AbortController()
    // The Request is held in a local rather than built inside `app.request`:
    // undici keeps the abort plumbing behind a WeakRef, so a garbage collection
    // between send and abort can silently drop the abort and redden this test.
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            id: 'm1',
            role: 'user',
            parts: [
              { type: 'text', text: 'Summarize Sprint 12 and draft release notes for v1.5.0.' },
            ],
          },
        ],
      }),
      signal: controller.signal,
    })
    const res = await app.request(request, undefined, env)
    expect(res.status).toBe(200)

    // This is what the composer's Stop button does: abort the in-flight fetch.
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let received = ''
    let reads = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += decoder.decode(value, { stream: true })
      reads += 1
      if (reads === 3) controller.abort()
    }

    // The stream stops mid-turn: no finish event, and the plan never completes.
    expect(received).not.toContain('"type":"finish"')
    expect(received).not.toContain('list_issues')
    // Keeps `request` reachable past the abort, which is the point of the local.
    expect(request.signal.aborted).toBe(true)
  })

  it('answers a follow-up sent after the user stopped a turn', async () => {
    // Stop leaves an assistant tool call with no result. Converting that to
    // model messages throws unless the dangling call is pruned, which used to
    // wedge the chat: every later message failed until the page was reloaded.
    const res = await app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              id: 'm1',
              role: 'user',
              parts: [{ type: 'text', text: 'Summarize Sprint 12 and draft release notes.' }],
            },
            {
              id: 'm2',
              role: 'assistant',
              parts: [
                { type: 'step-start' },
                {
                  type: 'tool-get_sprint_status',
                  toolCallId: 'aborted-call-1',
                  state: 'input-available',
                  input: {},
                },
              ],
            },
            {
              id: 'm3',
              role: 'user',
              parts: [{ type: 'text', text: 'How many open issues are in the current sprint?' }],
            },
          ],
        }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const chunks = parseChunks(await res.text())
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false)
    expect(textOf(chunks)).toContain('5 open issues')
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
