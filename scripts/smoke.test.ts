import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatTurnChecks, readShell, spendLimitOn } from './smoke.ts'

const WEB = 'https://web.test'
const shell = (entry: string) =>
  `<div id="app"></div><script src="/assets/index-${entry}.js"></script>`
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } })
const js = (body: string) => new Response(body, { headers: { 'content-type': 'text/javascript' } })

void test('waits out a previous shell whose entry the new version no longer has', async (t) => {
  let shells = 0
  t.mock.method(globalThis, 'fetch', (url: string) => {
    if (url === WEB) return Promise.resolve(html(shell(++shells === 1 ? 'old' : 'new')))
    return Promise.resolve(url.endsWith('index-new.js') ? js('new bundle') : html(shell('new')))
  })
  const read = await readShell(WEB, 5, 0)
  assert.equal(read.entry, '/assets/index-new.js')
  assert.equal(read.entrySource, 'new bundle')
  assert.equal(shells, 2)
})

void test('still hands a broken site to the checks after the last try', async (t) => {
  let shells = 0
  t.mock.method(globalThis, 'fetch', (url: string) => {
    if (url === WEB) shells += 1
    return Promise.resolve(html(shell('gone')))
  })
  const read = await readShell(WEB, 3, 0)
  assert.equal(read.entrySource.includes('<div id="app">'), true)
  assert.equal(shells, 3)
})

void test('does not wait on a shell that names no entry', async (t) => {
  const stub = t.mock.method(globalThis, 'fetch', () => Promise.resolve(html('<h1>down</h1>')))
  const read = await readShell(WEB, 5, 0)
  assert.equal(read.entry, '')
  assert.equal(stub.mock.callCount(), 1)
})

const turn = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers })

void test('names a spend limit only on a good response with a known value', () => {
  assert.equal(spendLimitOn(turn(200, { 'x-devsprint-limit': 'budget' })), 'budget')
  assert.equal(spendLimitOn(turn(200, { 'x-devsprint-limit': 'client-budget' })), 'client-budget')
  assert.equal(spendLimitOn(turn(200, { 'x-devsprint-limit': 'rate' })), undefined)
  assert.equal(spendLimitOn(turn(200, { 'x-devsprint-limit': 'other' })), undefined)
  assert.equal(spendLimitOn(turn(500, { 'x-devsprint-limit': 'budget' })), undefined)
  assert.equal(spendLimitOn(turn(200)), undefined)
})

void test('skips the turn checks at a spend limit, and says why', () => {
  const chat = chatTurnChecks(turn(200, { 'x-devsprint-limit': 'budget' }), 'the fixed message')
  assert.match(chat.skip ?? '', /budget limit/)
})

void test('still fails a turn that broke, with or without the header', () => {
  for (const broken of [turn(200), turn(500, { 'x-devsprint-limit': 'budget' })]) {
    const chat = chatTurnChecks(broken, 'no tool call')
    assert.equal(chat.skip, undefined)
    assert.equal(chat.grounded, false)
    assert.equal(chat.binding, false)
  }
})

void test('passes a real turn', () => {
  const chat = chatTurnChecks(turn(200, { 'x-devsprint-tools': 'mcp' }), '"tool-input-available"')
  assert.equal(chat.grounded, true)
  assert.equal(chat.binding, true)
})
