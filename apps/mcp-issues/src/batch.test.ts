import { describe, expect, it } from 'vitest'
import { refuseBatch } from './batch'

function post(body: string) {
  return new Request('https://mcp.test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

const call = (id: number) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'create_issue', arguments: { title: `t${id}`, type: 'bug' } },
})

describe('refuseBatch', () => {
  it('refuses an array of calls, which would ride one rate-limit token', async () => {
    const result = await refuseBatch(post(JSON.stringify([call(1), call(2), call(3)])))

    expect('refused' in result).toBe(true)
    if (!('refused' in result)) return
    expect(result.refused.status).toBe(400)
    await expect(result.refused.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600 },
    })
  })

  it('hands a single message on, already parsed for the transport', async () => {
    const result = await refuseBatch(post(JSON.stringify(call(1))))

    expect(result).toEqual({ parsedBody: call(1) })
  })

  it('answers a body that is not JSON with a parse error', async () => {
    const result = await refuseBatch(post('{not json'))

    expect('refused' in result).toBe(true)
    if (!('refused' in result)) return
    await expect(result.refused.json()).resolves.toMatchObject({ error: { code: -32700 } })
  })

  it('leaves a request without a body alone', async () => {
    const result = await refuseBatch(new Request('https://mcp.test/mcp', { method: 'GET' }))

    expect(result).toEqual({ parsedBody: undefined })
  })
})
