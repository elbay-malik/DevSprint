import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { jobSteps } from './ci-workflow.ts'

const ROOT = join(import.meta.dirname, '..')
const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')

void test('ci:local reads the checks job from ci.yml as written', () => {
  assert.deepEqual(jobSteps(workflow, 'checks'), [
    'pnpm install --frozen-lockfile',
    'pnpm lint',
    'pnpm format:check',
    'pnpm typecheck',
    'pnpm test',
    'pnpm build',
  ])
})

void test('ci:local reads the e2e job from ci.yml as written', () => {
  assert.deepEqual(jobSteps(workflow, 'e2e'), [
    'pnpm install --frozen-lockfile',
    'pnpm --filter @devsprint/web exec playwright install chromium --with-deps',
    'pnpm --filter @devsprint/web test:e2e',
  ])
})

void test('a job with a multi-line run step is refused, not half read', () => {
  const steps =
    'jobs:\n  checks:\n    steps:\n      - run: pnpm lint\n      - run: |\n          ls\n'
  assert.throws(() => jobSteps(steps, 'checks'), /multi-line run step/)
})

void test('a job that is not there is an error', () => {
  assert.throws(() => jobSteps(workflow, 'nope'), /no 'nope' job/)
})
