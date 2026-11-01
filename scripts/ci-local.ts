/**
 * Runs CI's `checks` and `e2e` jobs on this machine, for when GitHub Actions
 * cannot (it refused to start jobs over a billing problem on 2026-10-22):
 *
 *   pnpm ci:local               both jobs, as CI runs them
 *   pnpm ci:local --checks      the checks job only
 *   pnpm ci:local --e2e         the e2e job only
 *
 * The steps are read from .github/workflows/ci.yml rather than copied, so a
 * step added there is run here too. The e2e servers come from
 * apps/web/e2e/servers.ts, which playwright.config.ts also uses. Every step
 * runs with CI=1, as on a runner, so forbidOnly and the CI reporter apply.
 *
 * Steps get this shell's environment minus its credentials (ci-env.ts). That is
 * not a sandbox: it runs ci.yml verbatim as you, so a step can still read
 * ~/.wrangler and any .env file on disk.
 *
 * It never kills a process it did not start: if a port the stack needs is
 * taken, it stops and says what holds it. Logs go to .ci-local/.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { E2E_SERVERS, PREVIEW_PORT } from '../apps/web/e2e/servers.ts'
import { ciEnv } from './ci-env.ts'
import { jobSteps } from './ci-workflow.ts'

const ROOT = join(import.meta.dirname, '..')
const WEB = join(ROOT, 'apps/web')
const LOGS = join(ROOT, '.ci-local')
const ENV = ciEnv(process.env)

/** The single-line `- run:` steps of one job in ci.yml, in order. */
function stepsOf(job: string): string[] {
  return jobSteps(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'), job)
}

let logIndex = 0
function logFile(label: string): string {
  logIndex += 1
  return join(LOGS, `${String(logIndex).padStart(2, '0')}-${label.replace(/[^\w.-]+/g, '_')}.log`)
}

/** Runs one step to completion, quietly, and shows its tail only if it fails. */
function step(command: string, cwd = ROOT, env: NodeJS.ProcessEnv = ENV): boolean {
  const started = performance.now()
  process.stdout.write(`▶ ${command} `)
  const log = logFile(command)
  const result = spawnSync(command, { cwd, env, shell: true, encoding: 'utf8', maxBuffer: 1 << 28 })
  const output = `${result.stdout}${result.stderr}`
  // Synchronous: the process may exit right after, and a stream would not flush.
  writeFileSync(log, output)
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  if (result.status === 0) {
    console.log(`✓ ${seconds}s`)
    return true
  }
  console.log(`✗ ${seconds}s (exit ${result.status}) — full log: ${log}`)
  console.log(output.trimEnd().split('\n').slice(-40).join('\n'))
  return false
}

/** Free means we can bind it on both loopback addresses, as wrangler and Vite will. */
async function portFree(port: number): Promise<boolean> {
  const tryListen = (host: string) =>
    new Promise<boolean>((resolve) => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.listen(port, host, () => server.close(() => resolve(true)))
    })
  return (await tryListen('127.0.0.1')) && (await tryListen('::1'))
}

/** A port nothing is listening on, from the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function holderOf(port: number): string {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  return result.stdout.split('\n').slice(1).filter(Boolean).join('\n    ') || 'unknown process'
}

const started: ChildProcess[] = []

/**
 * SIGTERM first, so wrangler can take itself out of its dev registry. A server
 * killed outright stays listed there, and the next run's api binds to the dead
 * entry until the new one replaces it — long enough to fail the first test.
 * Each server runs in its own process group, so its workerd and Vite children
 * go with it.
 */
async function stopServers() {
  const children = started.splice(0).reverse()
  const signal = (child: ChildProcess, name: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, name)
    } catch {
      // Already gone.
    }
  }
  for (const child of children) signal(child, 'SIGTERM')
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve()
          const timer = setTimeout(() => {
            signal(child, 'SIGKILL')
            resolve()
          }, 5_000)
          child.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
        }),
    ),
  )
}
process.on('SIGINT', () => {
  void stopServers().then(() => process.exit(130))
})

/**
 * Polls with a fresh connection every time. fetch() keeps the first connection
 * alive and reuses it, so if that one landed on another process sharing the
 * port (before ours had bound it), every later poll asks the wrong server.
 */
function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get(url, { agent: false, timeout: 2_000 }, (res) => {
      res.resume()
      resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
  })
}

async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(url)) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

async function startServers(): Promise<boolean> {
  // Only the ports the tests talk to must be free. Each wrangler dev also opens
  // a debugger (9229, and 9230 for apps/mcp-issues), which other Wrangler
  // projects on the same machine often hold; those get a free port instead.
  const busy: string[] = []
  for (const port of [8787, 8788, 5173, PREVIEW_PORT]) {
    if (!(await portFree(port))) busy.push(`  :${port} is held by\n    ${holderOf(port)}`)
  }
  if (busy.length > 0) {
    console.log(`✗ ports the e2e stack needs are taken — stop these first:\n${busy.join('\n')}`)
    return false
  }
  for (const server of E2E_SERVERS) {
    process.stdout.write(`▶ start ${server.name} `)
    const log = logFile(`server-${server.name}`)
    const out = createWriteStream(log)
    const command = server.command.includes('wrangler dev')
      ? `${server.command} --inspector-port ${await freePort()}`
      : server.command
    const child = spawn(command, { cwd: WEB, env: ENV, shell: true, detached: true })
    child.stdout?.pipe(out)
    child.stderr?.pipe(out)
    started.push(child)
    if (!(await waitFor(server.url, 60_000))) {
      console.log(`✗ not ready at ${server.url} within 60s — log: ${log}`)
      return false
    }
    console.log('✓')
  }
  // Each server answering is not the stack being ready: the api's binding to
  // mcp-issues can still point at a stale registry entry. Ready means a real
  // (read-only) turn sources its issue tools over MCP.
  process.stdout.write('▶ api reaches mcp-issues over its binding ')
  if (!(await toolsComeOverMcp(60_000))) {
    console.log('✗ the api kept falling back to its local tools for 60s')
    return false
  }
  console.log('✓')
  return true
}

async function toolsComeOverMcp(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const body = JSON.stringify({
    messages: [
      { id: 'ready', role: 'user', parts: [{ type: 'text', text: 'How many open issues?' }] },
    ],
  })
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:8787/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      await res.text()
      if (res.headers.get('x-devsprint-tools') === 'mcp') return true
    } catch {
      // Not answering yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return false
}

function runChecks(): boolean {
  console.log('\n— checks —')
  for (const command of stepsOf('checks')) {
    if (!step(command)) return false
  }
  return true
}

async function runE2E(skipInstall: boolean): Promise<boolean> {
  console.log('\n— e2e —')
  try {
    for (const command of stepsOf('e2e')) {
      if (skipInstall && command === 'pnpm install --frozen-lockfile') continue
      if (command.includes('test:e2e')) {
        if (!(await startServers())) return false
        if (!step(command, ROOT, { ...ENV, E2E_EXTERNAL_SERVERS: '1' })) return false
        continue
      }
      // --with-deps installs Linux system packages; on macOS it is not needed
      // and would ask for sudo.
      const local = process.platform === 'darwin' ? command.replace(' --with-deps', '') : command
      if (!step(local)) return false
    }
    return true
  } finally {
    await stopServers()
  }
}

mkdirSync(LOGS, { recursive: true })
const only = process.argv.slice(2)
const wantChecks = !only.includes('--e2e')
const wantE2E = !only.includes('--checks')

const results: Array<[string, boolean]> = []
if (wantChecks) results.push(['checks', runChecks()])
if (wantE2E) results.push(['e2e', await runE2E(wantChecks)])

console.log(`\n${results.map(([job, ok]) => `${ok ? '✓' : '✗'} ${job}`).join('   ')}`)
process.exit(results.every(([, ok]) => ok) ? 0 : 1)
