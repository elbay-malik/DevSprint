import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { ciEnv } from './ci-env.ts'

const SCRIPTS = import.meta.dirname

void test('credentials are dropped and everything else is kept', () => {
  const env = ciEnv({
    CLOUDFLARE_API_TOKEN: 'x',
    CLOUDFLARE_ACCOUNT_ID: 'x',
    CF_API_TOKEN: 'x',
    CF_API_KEY: 'x',
    CF_EMAIL: 'x',
    CF_ACCOUNT_ID: 'x',
    WRANGLER_CF_AUTHORIZATION_TOKEN: 'x',
    WRANGLER_BASIN_SQL_AUTH_TOKEN: 'x',
    GROQ_API_KEY: 'x',
    GOOGLE_GENERATIVE_AI_API_KEY: 'x',
    LANGFUSE_SECRET_KEY: 'x',
    GH_TOKEN: 'x',
    GITHUB_TOKEN: 'x',
    PATH: '/bin',
    HOME: '/home/me',
    GITHUB_ACTIONS: 'true',
    MY_GROQ_NOTE: 'kept',
    MY_CF_NOTE: 'kept',
    WRANGLER_LOG: 'kept',
    WRANGLER_TOKEN_URL: 'kept',
  })
  assert.deepEqual(env, {
    PATH: '/bin',
    HOME: '/home/me',
    GITHUB_ACTIONS: 'true',
    MY_GROQ_NOTE: 'kept',
    MY_CF_NOTE: 'kept',
    WRANGLER_LOG: 'kept',
    WRANGLER_TOKEN_URL: 'kept',
    CI: '1',
  })
})

void test('CI=1 wins over whatever the shell had', () => {
  assert.equal(ciEnv({ CI: '0' }).CI, '1')
})

const REAL_SERVERS = readFileSync(join(SCRIPTS, '../apps/web/e2e/servers.ts'), 'utf8')
const LEAKY_ENV = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: 'leak-me',
  CF_API_TOKEN: 'leak-me',
  GH_TOKEN: 'leak-me',
  CI: '0',
}

/** A throwaway repo where ci-local.ts itself runs, reading the given ci.yml and servers. */
function ciLocalRepo(t: TestContext, workflow: string, servers: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'devsprint-ci-env-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  for (const file of ['ci-local.ts', 'ci-env.ts', 'ci-workflow.ts']) {
    cpSync(join(SCRIPTS, file), join(root, 'scripts', file))
  }
  mkdirSync(join(root, 'apps/web/e2e'), { recursive: true })
  writeFileSync(join(root, 'apps/web/e2e/servers.ts'), servers)
  mkdirSync(join(root, '.github/workflows'), { recursive: true })
  writeFileSync(join(root, '.github/workflows/ci.yml'), workflow)
  return root
}

function ciLocal(root: string, job: string) {
  return spawnSync(process.execPath, ['scripts/ci-local.ts', job], {
    cwd: root,
    encoding: 'utf8',
    env: LEAKY_ENV,
  })
}

function listen(port = 0): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

/** A port nothing is listening on, from the OS. */
async function freePort(): Promise<number> {
  const server = await listen()
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

/**
 * Stands in for the whole e2e stack on one free port, so these tests hold none
 * of the ports the real one needs. It dumps the environment it was started with,
 * and answers every readiness check ci-local makes. It stops itself in case
 * ci-local dies before it can.
 */
const STUB_API = `import { createServer } from 'node:http'
createServer((_, res) => {
  res.setHeader('x-devsprint-tools', 'mcp')
  res.end()
}).listen(Number(process.argv[2]), '127.0.0.1')
setTimeout(() => process.exit(1), 120_000).unref()
`

function stubServers(port: number): string {
  const node = JSON.stringify(process.execPath)
  const servers = [
    {
      name: 'api',
      command: `env > ../../seen-by-server.txt && ${node} ../../stub-api.mjs ${port}`,
      url: `http://127.0.0.1:${port}/api/health`,
    },
  ]
  return `export const E2E_SERVERS = ${JSON.stringify(servers)}\n`
}

void test('a step that ci:local runs does not see the credentials', (t) => {
  // ci-local.ts itself, reading a ci.yml whose one step writes its environment out.
  const root = ciLocalRepo(
    t,
    'jobs:\n  checks:\n    steps:\n      - run: env > seen-env.txt\n',
    REAL_SERVERS,
  )
  const result = ciLocal(root, '--checks')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const seen = readFileSync(join(root, 'seen-env.txt'), 'utf8')
  assert.doesNotMatch(seen, /leak-me/)
  assert.match(seen, /^CI=1$/m)
  assert.match(seen, /^PATH=/m)
})

void test('the e2e servers and steps that ci:local runs do not see the credentials', async (t) => {
  const root = ciLocalRepo(
    t,
    [
      'jobs:',
      '  e2e:',
      '    steps:',
      '      - run: env > seen-by-step.txt',
      '      - run: env > seen-by-suite.txt # test:e2e',
      '',
    ].join('\n'),
    stubServers(await freePort()),
  )
  writeFileSync(join(root, 'stub-api.mjs'), STUB_API)

  const result = ciLocal(root, '--e2e')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  for (const file of ['seen-by-server.txt', 'seen-by-step.txt', 'seen-by-suite.txt']) {
    const seen = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(seen, /leak-me/, file)
    assert.match(seen, /^CI=1$/m, file)
    assert.match(seen, /^PATH=/m, file)
  }
  assert.match(readFileSync(join(root, 'seen-by-suite.txt'), 'utf8'), /^E2E_EXTERNAL_SERVERS=1$/m)
})

void test('a port one of the e2e servers needs being taken stops the run before it starts', async (t) => {
  const holder = await listen()
  t.after(() => holder.close())
  const address = holder.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const root = ciLocalRepo(
    t,
    'jobs:\n  e2e:\n    steps:\n      - run: echo test:e2e\n',
    stubServers(port),
  )

  const result = ciLocal(root, '--e2e')
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, new RegExp(`ports the e2e stack needs are taken[^]*:${port} is held`))
  assert.ok(!existsSync(join(root, 'seen-by-server.txt')), 'no server may have started')
})
