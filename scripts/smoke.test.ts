import assert from 'node:assert/strict'
import { test } from 'node:test'
import { limitOnTurn, readShell } from './smoke.ts'

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

void test('names a spend limit, and only a known one', () => {
  const on = (limit: string) => limitOnTurn(new Headers({ 'x-devsprint-limit': limit }))
  assert.equal(on('budget'), 'budget')
  assert.equal(on('client-budget'), 'client-budget')
  assert.equal(on('rate'), 'rate')
  assert.equal(on('something-else'), undefined)
  assert.equal(limitOnTurn(new Headers()), undefined)
})
