import assert from 'node:assert/strict'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  deployRefusal,
  missingProviderSecret,
  unknownProvider,
  rollbackHints,
  type GitState,
} from './deploy-gates.ts'
import { expectedModelProvider, providerFromConfig } from './smoke.ts'

const SCRIPTS = import.meta.dirname

const CLEAN: GitState = { dirty: false, branch: 'main', head: 'abc', originMain: 'abc' }

void test('a clean main at origin may deploy', () => {
  assert.equal(deployRefusal(CLEAN), undefined)
})

void test('each way a checkout can differ from what was merged is named', () => {
  assert.match(
    deployRefusal({ ...CLEAN, branch: 'fix/thing' }) ?? '',
    /branch fix\/thing, not main/,
  )
  assert.match(deployRefusal({ ...CLEAN, branch: '' }) ?? '', /detached HEAD/)
  assert.match(deployRefusal({ ...CLEAN, dirty: true }) ?? '', /uncommitted changes/)
  assert.match(
    deployRefusal({ ...CLEAN, head: 'def' }) ?? '',
    /HEAD is def, but origin\/main is abc/,
  )
})

void test('every reason is reported at once', () => {
  const reason = deployRefusal({ dirty: true, branch: 'x', head: 'a', originMain: 'b' }) ?? ''
  assert.match(reason, /branch x/)
  assert.match(reason, /uncommitted/)
  assert.match(reason, /origin\/main/)
})

const GROQ = 'GROQ_API_KEY'
void test('auto and groq both need the Groq key, and a Google key does not stand in', () => {
  for (const provider of ['auto', 'groq']) {
    assert.equal(missingProviderSecret(provider, new Set()), GROQ)
    assert.equal(missingProviderSecret(provider, new Set(['GOOGLE_GENERATIVE_AI_API_KEY'])), GROQ)
    assert.equal(missingProviderSecret(provider, new Set([GROQ])), undefined)
  }
})

void test('mock needs no key', () => {
  assert.equal(missingProviderSecret('mock', new Set()), undefined)
})

void test('a provider the api would reject is named, and is not a missing key', () => {
  assert.match(unknownProvider('openai') ?? '', /'openai'/)
  assert.equal(missingProviderSecret('openai', new Set()), undefined)
})

void test('gemini is no longer a provider (ADR-0026)', () => {
  assert.match(unknownProvider('gemini') ?? '', /'gemini'/)
})

void test('every provider the api accepts is known', () => {
  for (const provider of ['auto', 'groq', 'mock']) {
    assert.equal(unknownProvider(provider), undefined)
  }
})

void test('the provider is read the way the api reads it, so a blank one is not refused', () => {
  assert.equal(providerFromConfig(undefined), 'auto')
  assert.equal(providerFromConfig(''), 'auto')
  assert.equal(providerFromConfig('   '), 'auto')
  assert.equal(providerFromConfig('groq '), 'groq')
})

void test('the provider checked is the one the committed config deploys', () => {
  const config = readFileSync(join(SCRIPTS, '../apps/api/wrangler.jsonc'), 'utf8')
  const committed = /"MODEL_PROVIDER":\s*"(\w+)"/.exec(config)?.[1]
  assert.ok(committed, 'apps/api/wrangler.jsonc names no MODEL_PROVIDER')
  assert.equal(expectedModelProvider(), committed)
})

void test('the provider comes from the config, and defaults to auto without one', async (t) => {
  // A copy of smoke.ts, because it finds the config relative to its own file.
  const base = mkdtempSync(join(tmpdir(), 'devsprint-provider-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  mkdirSync(join(base, 'scripts'))
  mkdirSync(join(base, 'apps/api'), { recursive: true })
  cpSync(join(SCRIPTS, 'smoke.ts'), join(base, 'scripts/smoke.ts'))
  symlinkSync(join(SCRIPTS, '../node_modules'), join(base, 'node_modules'))
  const copy = (await import(
    pathToFileURL(join(base, 'scripts/smoke.ts')).href
  )) as typeof import('./smoke.ts')
  const config = join(base, 'apps/api/wrangler.jsonc')

  writeFileSync(config, '{\n  // jsonc\n  "vars": { "MODEL_PROVIDER": "mock" },\n}\n')
  assert.equal(copy.expectedModelProvider(), 'mock')
  writeFileSync(config, '{ "vars": {} }\n')
  assert.equal(copy.expectedModelProvider(), 'auto')
})

void test('rollback hints name only what shipped, last shipped first', () => {
  const commands = (shipped: Parameters<typeof rollbackHints>[0]) =>
    rollbackHints(shipped).filter((line) => line.includes('wrangler rollback'))
  assert.deepEqual(commands(['mcp-issues', 'api', 'web']), [
    '  pnpm --filter @devsprint/web exec wrangler rollback',
    '  pnpm --filter @devsprint/api exec wrangler rollback',
    '  pnpm --filter @devsprint/mcp-issues exec wrangler rollback',
  ])
  assert.deepEqual(commands(['mcp-issues']), [
    '  pnpm --filter @devsprint/mcp-issues exec wrangler rollback',
  ])
})

void test('no rollback hints when nothing shipped', () => {
  assert.deepEqual(rollbackHints([]), [])
})
