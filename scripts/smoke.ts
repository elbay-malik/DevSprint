/**
 * Checks a deployed topology the way it can actually be wrong, not just "is it
 * up": each check names the misconfiguration it would catch.
 *
 *   pnpm smoke          (read-only — safe against the live demo at any time)
 *
 * The deploy script also calls it after every deploy. On the first deploy it
 * additionally proves the two Workers share one board by writing through MCP
 * and reading back through the api — which mutates the board, so it then
 * resets it, and it is only done while nobody can have been using it yet.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const SUBDOMAIN = 'eleo-666.workers.dev'
export const URLS = {
  web: `https://devsprint-web.${SUBDOMAIN}`,
  api: `https://devsprint-api.${SUBDOMAIN}`,
  mcp: `https://devsprint-mcp-issues.${SUBDOMAIN}`,
}

/** MODEL_PROVIDER as apps/api/wrangler.jsonc deploys it. */
function expectedModelProvider(): string {
  const path = join(import.meta.dirname, '../apps/api/wrangler.jsonc')
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'))
  const vars = (parsed.config as { vars?: Record<string, string> } | undefined)?.vars
  return vars?.MODEL_PROVIDER ?? 'auto'
}

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

/** One JSON-RPC call to the MCP endpoint, as any Streamable HTTP host makes it. */
async function mcp(method: string, params: unknown, id = 1): Promise<unknown> {
  const res = await fetch(`${URLS.mcp}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const text = await res.text()
  // The server may answer as plain JSON or as one SSE event.
  const payload = text.startsWith('{')
    ? text
    : (text
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length) ?? 'null')
  const message = JSON.parse(payload) as { result?: unknown; error?: { message: string } }
  if (message.error) throw new Error(`${method}: ${message.error.message}`)
  return message.result
}

/** Unwraps a tool's `{ ok, data }` envelope from its text content. */
async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = (await mcp('tools/call', { name, arguments: args })) as {
    content: Array<{ text: string }>
  }
  const envelope = JSON.parse(result.content[0]?.text ?? 'null') as { ok: boolean; data: T }
  if (!envelope.ok) throw new Error(`${name} returned ${JSON.stringify(envelope)}`)
  return envelope.data
}

async function apiIssueKeys(): Promise<string[]> {
  const res = await fetch(`${URLS.api}/api/workspace`)
  const workspace = (await res.json()) as { issues: Array<{ key: string }> }
  return workspace.issues.map((issue) => issue.key).sort()
}

/**
 * Reads the shell and its entry script once the two agree. Right after a deploy
 * an edge can still serve the previous shell, whose entry the new version no
 * longer has, and the Worker answers that path with index.html. That passes
 * within seconds, so it is waited out. A shell naming no entry is returned at
 * once, and after the last try whatever came back goes to the checks, so a
 * broken build still fails them.
 */
export async function readShell(url: string, tries = 20, pauseMs = 3000) {
  for (let attempt = 1; ; attempt += 1) {
    const page = await fetch(url)
    const html = await page.text()
    const entry = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1] ?? ''
    const script = entry ? await fetch(`${url}${entry}`) : undefined
    const entrySource = script ? await script.text() : ''
    const isScript = script?.headers.get('content-type')?.includes('javascript') ?? false
    if (!entry || isScript || attempt >= tries) {
      return { ok: page.ok, html, entry, entrySource }
    }
    await new Promise((resolve) => setTimeout(resolve, pauseMs))
  }
}

export async function smoke(options: { proveSharedBoard: boolean } = { proveSharedBoard: false }) {
  failures = 0
  console.log(`\nSmoke checks against ${SUBDOMAIN}`)

  // The SPA, and that its build points at the deployed api: a build without
  // VITE_API_URL calls relative /api paths, which this Worker answers with
  // index.html, and the board quietly falls back to seed data.
  const { ok, html, entry, entrySource } = await readShell(URLS.web)
  check('SPA serves its shell', ok && html.includes('<div id="app">'))
  // The api URL lives in whichever chunk imports lib/api.ts (today the lazily
  // loaded HomeView), so the entry and every chunk it references are searched.
  const chunks = [...new Set(entrySource.match(/assets\/[\w-]+\.js/g) ?? [])]
  const sources = [
    entrySource,
    ...(await Promise.all(
      chunks.map(async (chunk) => (await fetch(`${URLS.web}/${chunk}`)).text()),
    )),
  ]
  check(
    'SPA bundle calls the deployed api',
    sources.some((source) => source.includes(URLS.api)),
    `searched ${entry || 'no entry'} and ${chunks.length} chunk(s)`,
  )
  // The empty transcript names the MCP endpoint for outside clients, and hides
  // the line in a build without VITE_MCP_URL.
  check(
    'SPA bundle names the public MCP endpoint',
    sources.some((source) => source.includes(`${URLS.mcp}/mcp`)),
    `searched ${entry || 'no entry'} and ${chunks.length} chunk(s)`,
  )
  const robots = await fetch(`${URLS.web}/robots.txt`)
  check(
    'robots.txt is a file, not the SPA fallback',
    robots.ok && !(await robots.text()).includes('<html'),
  )

  // The api, and that CORS admits the SPA and its previews but not strangers.
  check('api health', (await fetch(`${URLS.api}/api/health`)).ok)
  const allowed = async (origin: string) =>
    (
      await fetch(`${URLS.api}/api/chat`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      })
    ).headers.get('access-control-allow-origin')
  check('CORS admits the SPA', (await allowed(URLS.web)) === URLS.web)
  const preview = `https://pr-1-devsprint-web.${SUBDOMAIN}`
  check('CORS admits a PR preview alias', (await allowed(preview)) === preview)
  check('CORS refuses another origin', (await allowed('https://example.com')) === null)
  const versionUrl = `https://3f9a1b2c-devsprint-web.${SUBDOMAIN}`
  check('CORS refuses a version URL', (await allowed(versionUrl)) === null)
  // Empty messages, so even a build without the refusal would spend nothing.
  const foreign = await fetch(`${URLS.api}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
    body: JSON.stringify({ messages: [] }),
  })
  check('a POST from another origin is refused', foreign.status === 403, `got ${foreign.status}`)

  // A real turn, read-only: the model the demo is meant to run, and the issue
  // tools sourced over the service binding rather than the local fallback.
  const turn = await fetch(`${URLS.api}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: URLS.web },
    body: JSON.stringify({
      messages: [
        {
          id: 'smoke',
          role: 'user',
          parts: [{ type: 'text', text: 'How many open issues are in the current sprint?' }],
        },
      ],
    }),
  })
  const stream = await turn.text()
  check('chat streams a grounded tool call', turn.ok && stream.includes('"tool-input-available"'))
  // The model the committed config asks for, so switching MODEL_PROVIDER is
  // a one-line change: `auto` may resolve to groq or gemini, never to mock.
  const configured = expectedModelProvider()
  const served = turn.headers.get('x-devsprint-model') ?? ''
  check(
    `chat runs the configured model (MODEL_PROVIDER=${configured})`,
    configured === 'auto' ? served !== 'mock' && served.length > 0 : served.startsWith(configured),
    `got ${served || 'none'}`,
  )
  check(
    'issue tools come over the service binding',
    turn.headers.get('x-devsprint-tools') === 'mcp',
    `got ${turn.headers.get('x-devsprint-tools')}`,
  )

  // The public MCP server (scenario S-F), and that it reads the same board.
  const tools = (await mcp('tools/list', {})) as { tools: Array<{ name: string }> }
  check(
    'MCP lists exactly the five issue tools',
    JSON.stringify(tools.tools.map((tool) => tool.name).sort()) ===
      JSON.stringify([
        'assign_issue',
        'create_issue',
        'list_issues',
        'search_issues',
        'update_issue_status',
      ]),
  )
  const viaMcp = (
    await callTool<{ issues: Array<{ key: string }> }>('list_issues', { limit: 200 })
  ).issues
    .map((issue) => issue.key)
    .sort()
  check(
    'MCP and the api read the same board',
    JSON.stringify(viaMcp) === JSON.stringify(await apiIssueKeys()),
  )

  // Two untouched boards are identical, so the read above cannot tell one
  // shared object from two fresh ones. A write can — on a board nobody uses yet.
  if (options.proveSharedBoard) {
    const created = await callTool<{ issue: { key: string } }>('create_issue', {
      title: 'Deploy smoke check',
      type: 'chore',
      priority: 'low',
      sprintId: null,
    })
    check(
      'a write over MCP is visible through the api',
      (await apiIssueKeys()).includes(created.issue.key),
    )
    const reset = await fetch(`${URLS.api}/api/workspace/reset`, { method: 'POST' })
    check('board reset to the seed afterwards', reset.ok && (await apiIssueKeys()).length === 13)
  }

  if (failures > 0) throw new Error(`${failures} smoke check(s) failed`)
  console.log('All smoke checks passed.')
}

if (import.meta.main) await smoke()
