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
  *"--filter @devsprint/"*" deploy"*)
    case "$*" in *"$STUB_DEPLOY_FAILS"*) [ -n "$STUB_DEPLOY_FAILS" ] && exit 7 ;; esac ;;
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

void test('an existing api with no provider key is refused before anything ships', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main, [], { STUB_SECRETS: secretsJson('TOOL_APPROVAL_SECRET') })
  assert.notEqual(run.status, 0, run.output)
  assert.match(run.output, /Refusing to deploy: MODEL_PROVIDER=auto needs GROQ_API_KEY or GOOGLE_/)
  assert.ok(!run.calls.some((call) => call.endsWith(' deploy')), run.calls.join(' | '))
})

void test('an existing api with one provider key deploys', (t) => {
  const repo = makeRepo(t)
  assertDeployed(
    repo.deploy(repo.main, [], {
      STUB_SECRETS: secretsJson('TOOL_APPROVAL_SECRET', 'GOOGLE_GENERATIVE_AI_API_KEY'),
    }),
  )
})

void test('a named provider is held to its own key', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main, [], {
    STUB_PROVIDER: 'gemini',
    STUB_SECRETS: secretsJson('TOOL_APPROVAL_SECRET', 'GROQ_API_KEY'),
  })
  assert.notEqual(run.status, 0, run.output)
  assert.match(run.output, /MODEL_PROVIDER=gemini needs GOOGLE_GENERATIVE_AI_API_KEY/)
})

void test('MODEL_PROVIDER=mock deploys with no provider key', (t) => {
  const repo = makeRepo(t)
  assertDeployed(
    repo.deploy(repo.main, [], {
      STUB_PROVIDER: 'mock',
      STUB_SECRETS: secretsJson('TOOL_APPROVAL_SECRET'),
    }),
  )
})

void test('a new api only warns, because a Worker that does not exist holds no secrets', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main, [], { STUB_API_EXISTS: '0', STUB_MCP_EXISTS: '0' })
  assertDeployed(run)
  assert.match(run.output, /set it after this deploy/)
})

void test('--plan reports a missing provider key and still exits clean', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main, ['--plan'], {
    STUB_SECRETS: secretsJson('TOOL_APPROVAL_SECRET'),
  })
  assert.equal(run.status, 0, run.output)
  assert.match(run.output, /a real deploy would stop here: MODEL_PROVIDER=auto needs/)
  assert.doesNotMatch(run.output, /Refusing/)
})

void test('--plan on a new api warns as the real deploy does, and does not predict a refusal', (t) => {
  const repo = makeRepo(t)
  const env = { STUB_API_EXISTS: '0', STUB_MCP_EXISTS: '0' }
  const plan = repo.deploy(repo.main, ['--plan'], env)
  assert.equal(plan.status, 0, plan.output)
  assert.match(plan.output, /First deploy plan:/)
  assert.doesNotMatch(plan.output, /would stop here/)
  const warning = /MODEL_PROVIDER=auto needs .*set it after this deploy/
  assert.match(plan.output, warning)
  const real = repo.deploy(repo.main, [], env)
  assertDeployed(real)
  assert.match(real.output, warning)
})

void test('a new api whose MCP Worker exists is told the same by --plan', (t) => {
  const repo = makeRepo(t)
  const plan = repo.deploy(repo.main, ['--plan'], { STUB_API_EXISTS: '0' })
  assert.match(plan.output, /Deploy plan:/)
  assert.doesNotMatch(plan.output, /would stop here/)
  assert.match(plan.output, /set it after this deploy/)
})

void test('the approval secret is still generated only when the api lacks it', (t) => {
  const repo = makeRepo(t)
  const has = repo.deploy(repo.main)
  assert.doesNotMatch(has.output, /TOOL_APPROVAL_SECRET will be generated/)
  assert.ok(!has.calls.some((call) => call.includes('--secrets-file')), has.calls.join(' | '))
  const lacks = repo.deploy(repo.main, [], { STUB_SECRETS: secretsJson('GROQ_API_KEY') })
  assert.match(lacks.output, /TOOL_APPROVAL_SECRET will be generated/)
  assert.ok(
    lacks.calls.some((call) => call.includes('--secrets-file')),
    lacks.calls.join(' | '),
  )
})

const smokeCall = (calls: string[]) => calls.find((call) => call.startsWith('smoke '))

void test('a routine deploy runs only the read-only smoke checks', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main)
  assert.equal(smokeCall(run.calls), 'smoke {"proveSharedBoard":false}')
  assert.doesNotMatch(run.output, /shared-board write/)
})

void test('a recreated MCP Worker does not write to the live board', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main, [], { STUB_MCP_EXISTS: '0' })
  assert.match(run.output, /First deploy plan:/)
  assert.doesNotMatch(run.output, /shared-board write/)
  assert.equal(smokeCall(run.calls), 'smoke {"proveSharedBoard":false}')
})

void test('a new api proves the shared board, because nobody can be using it', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main, [], { STUB_API_EXISTS: '0', STUB_MCP_EXISTS: '0' })
  assert.match(run.output, /including the shared-board write/)
  assert.equal(smokeCall(run.calls), 'smoke {"proveSharedBoard":true}')
})

void test('--plan shows the same answer on the shared-board write', (t) => {
  const repo = makeRepo(t)
  const recreated = repo.deploy(repo.main, ['--plan'], { STUB_MCP_EXISTS: '0' })
  assert.doesNotMatch(recreated.output, /shared-board write/)
  const fresh = repo.deploy(repo.main, ['--plan'], { STUB_API_EXISTS: '0', STUB_MCP_EXISTS: '0' })
  assert.match(fresh.output, /including the shared-board write/)
  assert.equal(smokeCall(fresh.calls), undefined)
})

void test('failed smoke checks print rollback commands and roll nothing back', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main, [], { STUB_SMOKE_FAILS: '1' })
  assert.notEqual(run.status, 0, run.output)
  assert.match(run.output, /1 smoke check\(s\) failed/)
  assert.match(run.output, /Nothing was rolled back/)
  for (const app of ['web', 'api', 'mcp-issues']) {
    assert.match(run.output, new RegExp(`--filter @devsprint/${app} exec wrangler rollback`))
  }
  assert.ok(!run.calls.some((call) => call.includes('rollback')), run.calls.join(' | '))
})

void test('a failed step names only the Workers that went out before it', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main, [], { STUB_DEPLOY_FAILS: '@devsprint/api' })
  assert.notEqual(run.status, 0, run.output)
  assert.match(run.output, /--filter @devsprint\/mcp-issues exec wrangler rollback/)
  assert.doesNotMatch(run.output, /--filter @devsprint\/(api|web) exec wrangler rollback/)
  assert.ok(!run.calls.some((call) => call.includes('@devsprint/web exec wrangler deploy')))
})

void test('a step that fails before anything shipped prints no rollback', (t) => {
  const repo = makeRepo(t)
  const run = repo.deploy(repo.main, [], { STUB_DEPLOY_FAILS: '@devsprint/mcp-issues' })
  assert.notEqual(run.status, 0, run.output)
  assert.doesNotMatch(run.output, /wrangler rollback/)
})

void test('a successful deploy prints no rollback', (t) => {
  const repo = makeRepo(t)
  assert.doesNotMatch(repo.deploy(repo.main).output, /rollback/)
})
