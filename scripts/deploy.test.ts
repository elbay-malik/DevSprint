/**
 * Runs the real scripts/deploy.ts in a throwaway git repo with a local origin,
 * so the gates are tested against real git, including a real feature-branch
 * worktree. Nothing here can reach Cloudflare or the live URLs: `pnpm` on PATH
 * is a stub that records its arguments, and smoke.ts is replaced by a stub.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test, type TestContext } from 'node:test'

const ROOT = join(import.meta.dirname, '..')

const STUB_PNPM = `#!/bin/sh
echo "$*" >> "$STUB_LOG"
case "$*" in
  *"deployments list --name devsprint-mcp-issues"*)
    [ "$STUB_MCP_EXISTS" = 1 ] && exit 0
    echo "code: 10007"
    exit 1 ;;
  *"deployments list --name devsprint-api"*)
    [ "$STUB_API_EXISTS" = 1 ] && exit 0
    echo "code: 10007"
    exit 1 ;;
  *"secret list"*)
    echo "$STUB_SECRETS" ;;
esac
exit 0
`

const STUB_SMOKE = `import { appendFileSync } from 'node:fs'
export function expectedModelProvider() {
  return process.env.STUB_PROVIDER ?? 'auto'
}
export async function smoke(options) {
  appendFileSync(process.env.STUB_LOG, 'smoke ' + JSON.stringify(options) + '\\n')
  if (process.env.STUB_SMOKE_FAILS) throw new Error('1 smoke check(s) failed')
}
`

const secretsJson = (...names: string[]) => JSON.stringify(names.map((name) => ({ name })))

interface Repo {
  /** The temp folder holding the origin, the clone, and any other checkout. */
  base: string
  /** A clone on main, level with origin. */
  main: string
  log: string
  git(cwd: string, ...args: string[]): string
  /** Runs scripts/deploy.ts from a checkout. */
  deploy(
    cwd: string,
    args?: string[],
    env?: Record<string, string>,
  ): { status: number | null; output: string; calls: string[] }
}

function makeRepo(t: TestContext): Repo {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'devsprint-deploy-')))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const log = join(base, 'calls.log')

  const bin = join(base, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'pnpm'), STUB_PNPM)
  chmodSync(join(bin, 'pnpm'), 0o755)

  // No GIT_DIR from a hook around this run, and no signing or hooks from this
  // machine's git config.
  const hermetic = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('GIT') && !name.startsWith('STUB_'),
    ),
  )
  const env = {
    ...hermetic,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    STUB_LOG: log,
    STUB_MCP_EXISTS: '1',
    STUB_API_EXISTS: '1',
    STUB_SECRETS: secretsJson('TOOL_APPROVAL_SECRET', 'GROQ_API_KEY'),
  }

  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }

  const origin = join(base, 'origin.git')
  const main = join(base, 'main')
  mkdirSync(main)
  git(base, 'init', '--quiet', '--bare', '-b', 'main', origin)
  git(main, 'init', '--quiet', '-b', 'main')
  git(main, 'remote', 'add', 'origin', origin)
  mkdirSync(join(main, 'scripts'))
  for (const file of ['deploy.ts', 'deploy-gates.ts']) {
    cpSync(join(ROOT, 'scripts', file), join(main, 'scripts', file))
  }
  writeFileSync(join(main, 'scripts/smoke.ts'), STUB_SMOKE)
  mkdirSync(join(main, 'apps/api'), { recursive: true })
  writeFileSync(join(main, 'apps/api/wrangler.jsonc'), '{ "name": "devsprint-api" }\n')
  git(main, 'add', '.')
  git(main, 'commit', '--quiet', '-m', 'first')
  git(main, 'push', '--quiet', '-u', 'origin', 'main')

  return {
    base,
    main,
    log,
    git,
    deploy(cwd, args = [], extra = {}) {
      // Untracked in every checkout, which the gate has to allow. deploy.ts
      // resolves typescript through it.
      const modules = join(cwd, 'node_modules')
      if (!existsSync(modules)) symlinkSync(join(ROOT, 'node_modules'), modules)
      rmSync(log, { force: true })
      const result = spawnSync(process.execPath, ['scripts/deploy.ts', ...args], {
        cwd,
        env: { ...env, ...extra },
        encoding: 'utf8',
      })
      return {
        status: result.status,
        output: `${result.stdout}${result.stderr}`,
        calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [],
      }
    },
  }
}

function assertRefused(run: ReturnType<Repo['deploy']>, reason: RegExp) {
  assert.notEqual(run.status, 0, run.output)
  assert.match(run.output, /Refusing to deploy/)
  assert.match(run.output, reason)
  assert.deepEqual(run.calls, [], 'nothing may be built or deployed')
}

function assertDeployed(run: ReturnType<Repo['deploy']>) {
  assert.equal(run.status, 0, run.output)
  assert.ok(
    run.calls.some((call) => call.includes('@devsprint/web') && call.endsWith('deploy')),
    `no deploy in ${run.calls.join(' | ')}`,
  )
}

void test('a clean main level with origin deploys', (t) => {
  const repo = makeRepo(t)
  assertDeployed(repo.deploy(repo.main))
})

void test('a feature-branch worktree is refused, even at the same commit as main', (t) => {
  const repo = makeRepo(t)
  const worktree = join(repo.base, 'feature-worktree')
  repo.git(repo.main, 'worktree', 'add', '--quiet', '-b', 'fix/some-thing', worktree)
  assert.equal(repo.git(worktree, 'rev-parse', 'HEAD'), repo.git(repo.main, 'rev-parse', 'HEAD'))
  assertRefused(repo.deploy(worktree), /branch fix\/some-thing, not main/)
})

void test('a feature-branch worktree with its own commits is refused', (t) => {
  const repo = makeRepo(t)
  const worktree = join(repo.base, 'feature-worktree')
  repo.git(repo.main, 'worktree', 'add', '--quiet', '-b', 'fix/some-thing', worktree)
  writeFileSync(join(worktree, 'change.txt'), 'x')
  repo.git(worktree, 'add', 'change.txt')
  repo.git(worktree, 'commit', '--quiet', '-m', 'change')
  assertRefused(repo.deploy(worktree), /branch fix\/some-thing, not main.*origin\/main is/)
})

void test('a detached HEAD at origin/main is refused', (t) => {
  const repo = makeRepo(t)
  repo.git(repo.main, 'checkout', '--quiet', '--detach')
  assertRefused(repo.deploy(repo.main), /detached HEAD/)
})

void test('a changed tracked file is refused', (t) => {
  const repo = makeRepo(t)
  writeFileSync(join(repo.main, 'apps/api/wrangler.jsonc'), '{ "name": "changed" }\n')
  assertRefused(repo.deploy(repo.main), /uncommitted changes/)
})

void test('a staged change is refused', (t) => {
  const repo = makeRepo(t)
  writeFileSync(join(repo.main, 'staged.txt'), 'x')
  repo.git(repo.main, 'add', 'staged.txt')
  assertRefused(repo.deploy(repo.main), /uncommitted changes/)
})

void test('untracked files do not block a deploy', (t) => {
  const repo = makeRepo(t)
  writeFileSync(join(repo.main, 'NOTES.md'), 'mine, and not for git')
  assertDeployed(repo.deploy(repo.main))
})

void test('local commits ahead of origin are refused', (t) => {
  const repo = makeRepo(t)
  writeFileSync(join(repo.main, 'ahead.txt'), 'x')
  repo.git(repo.main, 'add', 'ahead.txt')
  repo.git(repo.main, 'commit', '--quiet', '-m', 'ahead')
  assertRefused(repo.deploy(repo.main), /HEAD is \w+, but origin\/main is \w+/)
})

void test('being behind origin is refused, seen by fetching and not from a stale ref', (t) => {
  const repo = makeRepo(t)
  const other = join(repo.base, 'other')
  repo.git(repo.base, 'clone', '--quiet', join(repo.base, 'origin.git'), other)
  writeFileSync(join(other, 'newer.txt'), 'x')
  repo.git(other, 'add', 'newer.txt')
  repo.git(other, 'commit', '--quiet', '-m', 'newer')
  repo.git(other, 'push', '--quiet', 'origin', 'main')
  assert.equal(
    repo.git(repo.main, 'rev-parse', 'refs/remotes/origin/main'),
    repo.git(repo.main, 'rev-parse', 'HEAD'),
    'the clone has not fetched yet',
  )
  assertRefused(repo.deploy(repo.main), /HEAD is \w+, but origin\/main is \w+/)
})

void test('a fetch that fails is refused rather than compared with an old ref', (t) => {
  const repo = makeRepo(t)
  repo.git(repo.main, 'remote', 'set-url', 'origin', join(repo.base, 'gone.git'))
  assertRefused(repo.deploy(repo.main), /git fetch failed/)
})

void test('--skip-git-gate deploys anyway, and says so', (t) => {
  const repo = makeRepo(t)
  const worktree = join(repo.base, 'feature-worktree')
  repo.git(repo.main, 'worktree', 'add', '--quiet', '-b', 'hotfix', worktree)
  const run = repo.deploy(worktree, ['--skip-git-gate'])
  assertDeployed(run)
  assert.match(run.output, /deploying this checkout as it is/)
})

void test('--plan is not gated, and deploys nothing', (t) => {
  const repo = makeRepo(t)
  const worktree = join(repo.base, 'feature-worktree')
  repo.git(repo.main, 'worktree', 'add', '--quiet', '-b', 'fix/some-thing', worktree)
  writeFileSync(join(worktree, 'apps/api/wrangler.jsonc'), '{ "name": "changed" }\n')
  repo.git(worktree, 'remote', 'set-url', 'origin', join(repo.base, 'gone.git'))
  const run = repo.deploy(worktree, ['--plan'])
  assert.equal(run.status, 0, run.output)
  assert.match(run.output, /Deploy plan:/)
  assert.doesNotMatch(run.output, /Refusing/)
  assert.ok(!run.calls.some((call) => / deploy$| build$/.test(call)), run.calls.join(' | '))
})

void test('CI is not gated: it checks out a detached HEAD and has no credentials to fetch with', (t) => {
  const repo = makeRepo(t)
  repo.git(repo.main, 'checkout', '--quiet', '--detach')
  repo.git(repo.main, 'remote', 'set-url', 'origin', join(repo.base, 'gone.git'))
  assertDeployed(repo.deploy(repo.main, [], { GITHUB_ACTIONS: 'true' }))
})
