/**
 * Deploys the whole topology in the one order that works (ADR-0019), from a
 * laptop or from CI, first time or hundredth:
 *
 *   pnpm deploy:all
 *
 *   pnpm deploy:all --plan     print what it would do, deploy nothing
 *
 * From a laptop it refuses unless this checkout is on main, has no changes to
 * tracked files, and sits exactly at origin/main, so what ships is what was
 * merged. Untracked files are allowed. --plan is not gated, and neither is CI,
 * which checks out a detached HEAD of the commit it is deploying.
 *
 *   pnpm deploy:all --skip-git-gate     deploy this checkout anyway (a hotfix, or offline)
 *
 * The two Workers depend on each other: apps/api service-binds
 * devsprint-mcp-issues (its `Internal` entrypoint, ADR-0020), and
 * apps/mcp-issues binds the WorkspaceDO class that devsprint-api defines. The
 * very first deploy breaks that cycle by deploying the api once without its
 * service binding (it falls back to its local copy of the issue tools until the
 * MCP Worker exists), then the MCP Worker, then the api again with the binding.
 *
 * Every later deploy goes MCP Worker first, then api. Both orders leave a few
 * seconds where a change spanning both Workers runs half old, half new, because
 * each calls into the other at runtime. What the order decides is whether the
 * deploy can be refused halfway: the MCP Worker binds a Durable Object class
 * that already exists, so nothing about the api can block it, whereas the api
 * binds an MCP entrypoint that may only exist in the new MCP code (exactly what
 * PR #17 did). The one change this order cannot carry is a *new* Durable Object
 * class that the MCP Worker binds: that one needs the api deployed first, by
 * hand, with `pnpm --filter @devsprint/api exec wrangler deploy`.
 *
 * Auth is whatever wrangler already has: `wrangler login` locally,
 * CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in CI.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { deployRefusal } from './deploy-gates.ts'

const ROOT = join(import.meta.dirname, '..')
const SKIP_GIT_GATE = '--skip-git-gate'

type App = 'api' | 'mcp-issues' | 'web'

function run(command: string, args: string[], options: { capture?: boolean } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  return { status: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function wrangler(app: App, args: string[], options: { capture?: boolean } = {}) {
  return run('pnpm', ['--filter', `@devsprint/${app}`, 'exec', 'wrangler', ...args], options)
}

function must(step: string, result: { status: number; out: string }) {
  if (result.status !== 0) throw new Error(`${step} failed (exit ${result.status})\n${result.out}`)
  return result
}

function refuse(reason: string): never {
  console.error(`Refusing to deploy: ${reason}`)
  process.exit(1)
}

/** One line from git, or a refusal: a gate that cannot read the state must not open. */
function git(args: string[]): string {
  const result = run('git', args, { capture: true })
  if (result.status !== 0) {
    refuse(
      `git ${args[0]} failed (exit ${result.status}), so the checkout cannot be compared with origin/main. ` +
        `${SKIP_GIT_GATE} deploys anyway.\n${result.out}`,
    )
  }
  return result.out.trim()
}

/** Ships only what was merged. Compares with a fresh fetch, not the last one this clone did. */
function gitGate() {
  git(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'])
  const reason = deployRefusal({
    dirty: git(['status', '--porcelain', '--untracked-files=no']) !== '',
    branch: git(['branch', '--show-current']),
    head: git(['rev-parse', 'HEAD']),
    originMain: git(['rev-parse', 'refs/remotes/origin/main']),
  })
  if (reason) refuse(`${reason}. Deploy from a clean main, or pass ${SKIP_GIT_GATE}.`)
}

/** Whether a Worker exists on the account. Anything but "does not exist" is a real error. */
function workerExists(name: string): boolean {
  const result = wrangler('api', ['deployments', 'list', '--name', name], { capture: true })
  if (result.status === 0) return true
  if (result.out.includes('10007')) return false
  throw new Error(`could not tell whether ${name} exists:\n${result.out}`)
}

function apiHasApprovalSecret(): boolean {
  const result = must(
    'listing api secrets',
    wrangler('api', ['secret', 'list', '--format', 'json'], { capture: true }),
  )
  const json = result.out.slice(result.out.indexOf('['))
  const secrets = JSON.parse(json) as Array<{ name: string }>
  return secrets.some((secret) => secret.name === 'TOOL_APPROVAL_SECRET')
}

/** apps/api's config minus the service binding, for the first deploy only. */
function writeBootstrapConfig(): string {
  const source = join(ROOT, 'apps/api/wrangler.jsonc')
  const parsed = ts.parseConfigFileTextToJson(source, readFileSync(source, 'utf8'))
  if (parsed.error) throw new Error(`apps/api/wrangler.jsonc does not parse`)
  const config = parsed.config as Record<string, unknown>
  delete config.services
  // Written beside the original so `main` and `$schema` resolve the same way.
  const target = join(ROOT, 'apps/api/wrangler.bootstrap.json')
  writeFileSync(target, JSON.stringify(config, null, 2))
  return target
}

function deployApi(options: { bootstrap: boolean; secretsFile: string | undefined }) {
  const args = ['deploy']
  let bootstrapConfig: string | undefined
  if (options.bootstrap) {
    bootstrapConfig = writeBootstrapConfig()
    args.push('--config', bootstrapConfig)
  }
  if (options.secretsFile) args.push('--secrets-file', options.secretsFile)
  try {
    must(
      `deploying the api${options.bootstrap ? ' (bootstrap, no service binding)' : ''}`,
      wrangler('api', args),
    )
  } finally {
    if (bootstrapConfig) rmSync(bootstrapConfig, { force: true })
  }
}

async function main() {
  const planOnly = process.argv.includes('--plan')

  if (!planOnly && !process.env.GITHUB_ACTIONS) {
    if (process.argv.includes(SKIP_GIT_GATE)) {
      console.warn(`${SKIP_GIT_GATE}: deploying this checkout as it is, whatever its git state.`)
    } else {
      gitGate()
    }
  }

  // Built first so a type or build error stops the run before anything ships.
  if (!planOnly) must('building the SPA', run('pnpm', ['--filter', '@devsprint/web', 'build']))

  const firstDeploy = !workerExists('devsprint-mcp-issues')
  const apiExists = workerExists('devsprint-api')
  // The approval signing secret (ADR-0010) is generated once, here, and never
  // printed. Without it every isolate signs with its own random key, so an
  // approval issued by one would not verify on another.
  const needsSecret = !apiExists || !apiHasApprovalSecret()

  const steps: Array<{
    label: string
    /** Deploys the api, so it can carry the secrets file. */
    api?: true
    run: (secretsFile: string | undefined) => void
  }> = firstDeploy
    ? [
        {
          label: 'api, without its service binding (first deploy only)',
          api: true,
          run: (secretsFile) => deployApi({ bootstrap: true, secretsFile }),
        },
        {
          label: 'mcp-issues',
          run: () => must('deploying mcp-issues', wrangler('mcp-issues', ['deploy'])),
        },
        {
          label: 'api, with its binding',
          api: true,
          run: () => deployApi({ bootstrap: false, secretsFile: undefined }),
        },
      ]
    : [
        {
          label: 'mcp-issues',
          run: () => must('deploying mcp-issues', wrangler('mcp-issues', ['deploy'])),
        },
        {
          label: 'api',
          api: true,
          run: (secretsFile) => deployApi({ bootstrap: false, secretsFile }),
        },
      ]
  steps.push({ label: 'web', run: () => must('deploying the SPA', wrangler('web', ['deploy'])) })

  console.log(`${firstDeploy ? 'First deploy' : 'Deploy'} plan:`)
  steps.forEach((step, index) => console.log(`  ${index + 1}. ${step.label}`))
  console.log(`  then smoke checks${firstDeploy ? ', including the shared-board write' : ''}`)
  if (needsSecret) console.log('  TOOL_APPROVAL_SECRET will be generated (not shown)')
  if (planOnly) return

  let secretsDir: string | undefined
  let secretsFile: string | undefined
  if (needsSecret) {
    secretsDir = mkdtempSync(join(tmpdir(), 'devsprint-secrets-'))
    secretsFile = join(secretsDir, 'secrets.json')
    writeFileSync(
      secretsFile,
      JSON.stringify({ TOOL_APPROVAL_SECRET: randomBytes(32).toString('base64url') }),
      { mode: 0o600 },
    )
  }

  try {
    // The secret travels with the first api deploy in the plan; it is additive.
    let pending = secretsFile
    for (const step of steps) {
      const usesSecret = step.api === true && pending !== undefined
      step.run(usesSecret ? pending : undefined)
      if (usesSecret) pending = undefined
    }
  } finally {
    if (secretsDir) rmSync(secretsDir, { recursive: true, force: true })
  }

  const { smoke } = await import('./smoke.ts')
  await smoke({ proveSharedBoard: firstDeploy })
}

await main()
