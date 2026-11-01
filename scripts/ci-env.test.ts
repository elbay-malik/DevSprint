import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
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
  })
  assert.deepEqual(env, {
    PATH: '/bin',
    HOME: '/home/me',
    GITHUB_ACTIONS: 'true',
    MY_GROQ_NOTE: 'kept',
    MY_CF_NOTE: 'kept',
    CI: '1',
  })
})

void test('CI=1 wins over whatever the shell had', () => {
  assert.equal(ciEnv({ CI: '0' }).CI, '1')
})

void test('a step that ci:local runs does not see the credentials', (t) => {
  // ci-local.ts itself, reading a ci.yml whose one step writes its environment out.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'devsprint-ci-env-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  for (const file of ['ci-local.ts', 'ci-env.ts', 'ci-workflow.ts']) {
    cpSync(join(SCRIPTS, file), join(root, 'scripts', file))
  }
  mkdirSync(join(root, 'apps/web/e2e'), { recursive: true })
  cpSync(join(SCRIPTS, '../apps/web/e2e/servers.ts'), join(root, 'apps/web/e2e/servers.ts'))
  mkdirSync(join(root, '.github/workflows'), { recursive: true })
  writeFileSync(
    join(root, '.github/workflows/ci.yml'),
    'jobs:\n  checks:\n    steps:\n      - run: env > seen-env.txt\n',
  )

  const result = spawnSync(process.execPath, ['scripts/ci-local.ts', '--checks'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: 'leak-me', GH_TOKEN: 'leak-me', CI: '0' },
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const seen = readFileSync(join(root, 'seen-env.txt'), 'utf8')
  assert.doesNotMatch(seen, /leak-me/)
  assert.match(seen, /^CI=1$/m)
  assert.match(seen, /^PATH=/m)
})
