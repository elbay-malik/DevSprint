import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deployRefusal,
  missingProviderSecret,
  rollbackHints,
  type GitState,
} from './deploy-gates.ts'
import { expectedModelProvider } from './smoke.ts'

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
const GEMINI = 'GOOGLE_GENERATIVE_AI_API_KEY'

void test('auto needs either provider key', () => {
  assert.match(missingProviderSecret('auto', new Set()) ?? '', /GROQ_API_KEY or GOOGLE_/)
  assert.equal(missingProviderSecret('auto', new Set([GROQ])), undefined)
  assert.equal(missingProviderSecret('auto', new Set([GEMINI])), undefined)
})

void test('a named provider needs its own key, not the other one', () => {
  assert.equal(missingProviderSecret('groq', new Set([GEMINI])), GROQ)
  assert.equal(missingProviderSecret('groq', new Set([GROQ])), undefined)
  assert.equal(missingProviderSecret('gemini', new Set([GROQ])), GEMINI)
  assert.equal(missingProviderSecret('gemini', new Set([GEMINI])), undefined)
})

void test('mock needs no key', () => {
  assert.equal(missingProviderSecret('mock', new Set()), undefined)
})

void test('a provider the api would reject is not let through', () => {
  assert.match(missingProviderSecret('openai', new Set([GROQ, GEMINI])) ?? '', /not 'openai'/)
})

void test('the provider checked is the one the committed config deploys', () => {
  assert.equal(expectedModelProvider(), 'auto')
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
