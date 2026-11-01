import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { jobBlock, jobSteps } from './ci-workflow.ts'

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

void test('every action is pinned to a commit, with its version beside it', () => {
  const uses = [...workflow.matchAll(/^\s+(?:- )?uses: (.+)$/gm)].map((match) => match[1] ?? '')
  assert.ok(uses.length > 0)
  for (const line of uses) assert.match(line, /^[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
})

void test('the workflow token is read-only by default', () => {
  const head = workflow.slice(0, workflow.indexOf('\njobs:'))
  assert.match(head, /^permissions:\n {2}contents: read$/m)
})

void test('only the preview job widens the token, to comment on its PR', () => {
  assert.match(
    jobBlock(workflow, 'preview'),
    /permissions:\n\s+contents: read\n\s+pull-requests: write/,
  )
  for (const job of ['checks', 'e2e', 'deploy']) {
    assert.doesNotMatch(jobBlock(workflow, job), /permissions:/)
  }
})

void test('no checkout leaves the token in .git/config', () => {
  const checkouts = workflow
    .split(/^(?=\s+- )/m)
    .filter((step) => step.includes('actions/checkout@'))
  assert.equal(checkouts.length, 5)
  for (const step of checkouts) assert.match(step, /with:\n\s+persist-credentials: false\n/)
})

void test('dependabot watches npm and the pinned actions, past the release-age gate', () => {
  const config = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8')
  const updates = config.split(/^(?= {2}- package-ecosystem:)/m).slice(1)
  assert.deepEqual(
    updates.map((update) => /package-ecosystem: (\S+)/.exec(update)?.[1]),
    ['npm', 'github-actions'],
  )
  for (const update of updates) {
    assert.match(update, /interval: weekly/)
    assert.match(update, /cooldown:\n\s+default-days: 3/)
    assert.match(update, /groups:/)
  }
})

void test('dependabot leaves the lines the catalog holds back alone', () => {
  const config = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8')
  for (const name of ['ai', "'@ai-sdk/*'", "'@modelcontextprotocol/sdk'"]) {
    const rule = new RegExp(
      `dependency-name: ${name.replace(/[*/]/g, '\\$&')}\\n\\s+update-types: \\['version-update:semver-major'\\]`,
    )
    assert.match(config, rule)
  }
  assert.match(config, /dependency-name: vue\n\s+versions: \['>=3\.6\.0'\]/)
})

void test('a Dependabot PR gets no preview, because it has no secrets', () => {
  assert.match(jobBlock(workflow, 'preview'), /^ {4}if: .*github\.actor != 'dependabot\[bot\]'$/m)
})

void test('the audit runs in a job that cannot fail the run or hold back a deploy', () => {
  assert.deepEqual(jobSteps(workflow, 'audit'), ['pnpm audit --prod --audit-level high'])
  assert.match(jobBlock(workflow, 'audit'), /^ {4}continue-on-error: true$/m)
  assert.match(jobBlock(workflow, 'deploy'), /^ {4}needs: \[checks, e2e\]$/m)
})
