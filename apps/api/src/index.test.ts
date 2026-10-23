import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('POST /api/chat — spend controls', () => {
  /**
   * A paid route. The budget is checked *before* the model is called, so a
   * bogus key never reaches the network — which is what lets the blocking path
   * be tested at all without spending quota.
   */
  const paid = { MODEL_PROVIDER: 'groq', GROQ_API_KEY: 'gsk-not-real' }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function askWith(overrides: Record<string, unknown>, text = 'How is the sprint going?') {
    return app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
        body: JSON.stringify({
          messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }],
        }),
      },
      { ...env, ...overrides },
    )
  }

  it('turns a rate-limited request into a readable turn, not a 429', async () => {
    const res = await askWith({
      CHAT_RATE_LIMIT: { limit: () => Promise.resolve({ success: false }) },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('x-devsprint-limit')).toBe('rate')
    const answer = textOf(parseChunks(await res.text()))
    expect(answer).toContain('Too many requests')
    // The model was never reached, which is the point of checking first.
    expect(answer).not.toContain('23 of 31 points remaining')
  })

  it('lets a request through when the limiter allows it', async () => {
    const res = await askWith({
      CHAT_RATE_LIMIT: { limit: () => Promise.resolve({ success: true }) },
    })

    expect(res.headers.get('x-devsprint-limit')).toBeNull()
    expect(textOf(parseChunks(await res.text()))).toContain('23 of 31 points remaining')
  })

  it('runs unlimited when no limiter is bound, so dev and CI are unaffected', async () => {
    const res = await askWith({})
    expect(res.status).toBe(200)
    expect(res.headers.get('x-devsprint-limit')).toBeNull()
  })

  it('exempts the scripted mock from the budget, because it spends nothing', async () => {
    // The whole board's budget would otherwise be rationed by tests and local
    // dev, which consume no provider quota at all.
    workspace.store.recordModelUsage(999_999)

    const res = await askWith({ DAILY_TOKEN_CAP: '100' })

    expect(res.headers.get('x-devsprint-limit')).toBeNull()
    expect(textOf(parseChunks(await res.text()))).toContain('23 of 31 points remaining')
    workspace.store.reset()
  })

  it("degrades to a designed turn once the day's budget is gone", async () => {
    workspace.store.recordModelUsage(120_000)

    const res = await askWith({ ...paid, DAILY_TOKEN_CAP: '100000' })

    expect(res.status).toBe(200)
    expect(res.headers.get('x-devsprint-limit')).toBe('budget')
    const answer = textOf(parseChunks(await res.text()))
    expect(answer).toContain('model budget for today')
    // ADR-0005 asks for a designed state rather than a provider error.
    expect(answer).not.toMatch(/error|failed|unauthorized/i)
  })

  it('still answers while the budget has room', async () => {
    // A fresh store, because the tests above deliberately leave spend behind.
    const fresh = fakeWorkspaceBinding()
    fresh.store.recordModelUsage(10)

    const res = await app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'How is the sprint going?' }] },
          ],
        }),
      },
      { ...env, ...paid, WORKSPACE: fresh.binding, DAILY_TOKEN_CAP: '100000' },
    )

    expect(res.headers.get('x-devsprint-limit')).toBeNull()
  })

  it("records a paid turn's spend against the day's budget", async () => {
    // The blocking path above only proves the cap is *read*. Nothing in CI uses
    // a paid provider, so without this the recording side could silently never
    // fire — every turn charging nothing, the cap never reached, and no test
    // any the wiser. A stubbed SSE response stands in for Groq.
    const chunk = (extra: Record<string, unknown>) =>
      `data: ${JSON.stringify({
        id: '1',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'llama-3.3-70b-versatile',
        ...extra,
      })}\n\n`
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' } }] }) +
            chunk({
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              x_groq: { usage: { prompt_tokens: 1200, completion_tokens: 300 } },
            }) +
            'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      ),
    )
    const fresh = fakeWorkspaceBinding()
    expect(fresh.store.modelUsage().tokens).toBe(0)

    const res = await app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
        }),
      },
      { ...env, ...paid, WORKSPACE: fresh.binding, DAILY_TOKEN_CAP: '100000' },
    )
    await res.text()

    // Recording rides `waitUntil`, so it lands after the body has streamed.
    for (let attempt = 0; attempt < 50 && fresh.store.modelUsage().tokens === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(fresh.store.modelUsage().tokens).toBe(1500)
  })

  it('does not let Reset buy back budget', async () => {
    // The board and the ledger both mean "start the demo over"; the budget does
    // not, or a visitor could clear the spend cap by pressing a button. Asserted
    // as "unchanged across the reset" rather than against a fixed number,
    // because `store.reset()` deliberately leaves usage alone — which is the
    // property under test, and which makes usage carry between tests.
    const before = workspace.store.recordModelUsage(50_000).tokens
    expect(before).toBeGreaterThan(0)

    await app.request('/api/workspace/reset', { method: 'POST' }, env)

    expect(workspace.store.modelUsage().tokens).toBe(before)
  })
})

describe('POST /api/chat — tracing', () => {
  const traced = {
    ...env,
    LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
    LANGFUSE_SECRET_KEY: 'sk-lf-test',
    LANGFUSE_HOST: 'https://collector.test',
  }

  function askTraced(text: string, overrides: Record<string, unknown> = {}) {
    return app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }],
        }),
      },
      { ...traced, ...overrides },
    )
  }

  /** The OTLP POST, once the flush that rides `waitUntil` has landed. */
  async function exportedSpans(fetchMock: ReturnType<typeof vi.fn>) {
    for (let attempt = 0; attempt < 50 && fetchMock.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const call = fetchMock.mock.calls[0] as [string, { body: string }] | undefined
    if (!call) return undefined
    const body = JSON.parse(call[1].body) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<Record<string, string>> }> }>
    }
    return { url: call[0], spans: body.resourceSpans[0]!.scopeSpans[0]!.spans }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exports a complete trace, with the root span and no orphans', async () => {
    // The flush used to run from the agent's own `onFinish`, while the root
    // `ai.streamText` span was still open — so every span went out pointing at
    // a parent that was never sent with them. Only the ordering through the
    // real route can catch that, which is why this is not a unit test.
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await askTraced('How many open issues are in the current sprint?')
    await res.text()

    const exported = await exportedSpans(fetchMock)
    expect(exported?.url).toBe('https://collector.test/api/public/otel/v1/traces')

    const spans = exported?.spans ?? []
    expect(spans.length).toBeGreaterThan(1)

    const ids = new Set(spans.map((span) => span.spanId))
    const roots = spans.filter((span) => span.parentSpanId === undefined)
    expect(roots).toHaveLength(1)
    expect(roots[0]?.name).toBe('ai.streamText')
    // Every non-root points at a span that went out in the same batch.
    for (const span of spans) {
      if (span.parentSpanId !== undefined) expect(ids.has(span.parentSpanId)).toBe(true)
    }
  })

  it('reports the trace id back, so a log line can be joined to its trace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    const res = await askTraced('How is the sprint going?')
    await res.text()

    expect(res.headers.get('x-devsprint-trace')).toMatch(/^[0-9a-f]{32}$/)
    expect(res.headers.get('access-control-expose-headers')).toContain('X-DevSprint-Trace')
  })

  it('survives an approval resume, which continues an existing message', async () => {
    // The response-level onFinish reconstructs the assistant message, and a
    // resumed turn *continues* one rather than starting it. Without
    // `originalMessages` that reconstruction throws "No tool invocation found
    // for tool call ID" — and because the callback was only attached when
    // tracing was on, the whole path was unreachable until it was.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))

    const first = await app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              id: 'm1',
              role: 'user',
              parts: [{ type: 'text', text: 'Deploy v9.1.0 to staging.' }],
            },
          ],
        }),
      },
      traced,
    )
    const chunks = parseChunks(await first.text())
    const approval = chunks.find((chunk) => chunk.type === 'tool-approval-request')
    const call = chunks.find((chunk) => chunk.type === 'tool-input-available')
    expect(approval).toBeDefined()

    const resumed = await app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              id: 'm1',
              role: 'user',
              parts: [{ type: 'text', text: 'Deploy v9.1.0 to staging.' }],
            },
            {
              id: 'a1',
              role: 'assistant',
              parts: [
                { type: 'step-start' },
                {
                  type: `tool-${String(call?.toolName)}`,
                  toolCallId: String(call?.toolCallId),
                  state: 'approval-responded',
                  input: call?.input,
                  approval: {
                    id: String((approval as { approvalId?: string }).approvalId),
                    approved: false,
                    reason: 'not now',
                    signature: (approval as { signature?: string }).signature,
                  },
                },
              ],
            },
          ],
        }),
      },
      traced,
    )

    expect(resumed.status).toBe(200)
    const body = await resumed.text()
    expect(body).not.toContain('No tool invocation found')
  })

  it('stays entirely off without keys — no header, no export', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await ask('How is the sprint going?')
    await res.text()
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(res.headers.get('x-devsprint-trace')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still answers when the collector is down', async () => {
    // Losing a trace is not a reason to turn a served request into a failure.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('collector down')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await askTraced('How many open issues are in the current sprint?')

    expect(res.status).toBe(200)
    expect(textOf(parseChunks(await res.text()))).toContain('5 open')
  })
})

describe('POST /api/chat', () => {
  it('answers the acceptance question with a grounded tool call', async () => {
    const res = await ask('How many open issues are in the current sprint?')

    expect(res.status).toBe(200)
    // An event stream is always UTF-8; saying so keeps header-honouring tools
    // from reading it as Latin-1.
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
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

    // Scenario S-A's documented chain: sprint health, the work that shipped,
    // then the diff of the composed draft against the last published notes.
    // The diff used to be missing entirely, which meant S-A stopped at step 3.
    const calls = chunks
      .filter((chunk) => chunk.type === 'tool-input-available')
      .map((chunk) => chunk.toolName)
    expect(calls).toEqual(['get_sprint_status', 'list_issues', 'diff_release_notes'])

    // The draft is composed from the issues the previous step returned, not
    // hard-coded — so it names the work that actually shipped.
    const draft = chunks.find(
      (chunk) => chunk.type === 'tool-input-available' && chunk.toolName === 'diff_release_notes',
    )?.input as { draftMarkdown: string } | undefined
    expect(draft?.draftMarkdown).toContain('v1.5.0')
    expect(draft?.draftMarkdown).toContain('DS-5')
    expect(draft?.draftMarkdown).toContain('DS-6')

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
