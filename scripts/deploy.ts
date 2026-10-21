/**
 * Deploys the whole topology in the one order that works (ADR-0019), from a
 * laptop or from CI, first time or hundredth:
 *
 *   pnpm deploy:all
 *
 * The two Workers depend on each other: apps/api service-binds
 * devsprint-mcp-issues, and apps/mcp-issues binds the WorkspaceDO class that
 * devsprint-api defines. The very first deploy breaks that cycle by deploying
 * the api once without its service binding (it falls back to its local copy
 * of the issue tools until the MCP Worker exists), then the MCP Worker, then
 * the api again with the binding. Every later deploy is a straight run.
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

const ROOT = join(import.meta.dirname, '..')

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
  // Built first so a type or build error stops the run before anything ships.
  must('building the SPA', run('pnpm', ['--filter', '@devsprint/web', 'build']))

  const firstDeploy = !workerExists('devsprint-mcp-issues')
  const apiExists = workerExists('devsprint-api')

  // The approval signing secret (ADR-0010) is generated once, here, and never
  // printed. Without it every isolate signs with its own random key, so an
  // approval issued by one would not verify on another.
  let secretsDir: string | undefined
  let secretsFile: string | undefined
  if (!apiExists || !apiHasApprovalSecret()) {
    secretsDir = mkdtempSync(join(tmpdir(), 'devsprint-secrets-'))
    secretsFile = join(secretsDir, 'secrets.json')
    writeFileSync(
      secretsFile,
      JSON.stringify({ TOOL_APPROVAL_SECRET: randomBytes(32).toString('base64url') }),
      { mode: 0o600 },
    )
    console.log('Setting TOOL_APPROVAL_SECRET (generated, not shown).')
  }

  try {
    if (firstDeploy) {
      console.log('First deploy: breaking the api ⇄ mcp-issues binding cycle.')
      deployApi({ bootstrap: true, secretsFile })
      must('deploying mcp-issues', wrangler('mcp-issues', ['deploy']))
      deployApi({ bootstrap: false, secretsFile: undefined })
    } else {
      deployApi({ bootstrap: false, secretsFile })
      must('deploying mcp-issues', wrangler('mcp-issues', ['deploy']))
    }
  } finally {
    if (secretsDir) rmSync(secretsDir, { recursive: true, force: true })
  }

  must('deploying the SPA', wrangler('web', ['deploy']))

  const { smoke } = await import('./smoke.ts')
  await smoke({ proveSharedBoard: firstDeploy })
}

await main()
