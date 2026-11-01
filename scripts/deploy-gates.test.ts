import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deployRefusal, type GitState } from './deploy-gates.ts'

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
