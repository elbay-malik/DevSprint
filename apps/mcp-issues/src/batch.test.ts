import { describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES, refuseBatch, refuseNonPost } from './batch'

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

/** A valid message of exactly `bytes` bytes, padded with an extra field. */
function messageOf(bytes: number): string {
  const empty = JSON.stringify({ ...call(1), padding: '' })
  return JSON.stringify({ ...call(1), padding: 'x'.repeat(bytes - empty.length) })
}

describe('refuseNonPost', () => {
  it.each(['GET', 'DELETE', 'OPTIONS', 'PUT'])(
    'answers %s with a 405 naming POST',
    async (method) => {
      const response = refuseNonPost(new Request('https://mcp.test/mcp', { method }))

      expect(response?.status).toBe(405)
      expect(response?.headers.get('Allow')).toBe('POST')
      await expect(response?.json()).resolves.toMatchObject({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000 },
      })
    },
  )

  it('leaves a POST alone', () => {
    expect(refuseNonPost(post(JSON.stringify(call(1))))).toBeUndefined()
  })
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

  it('refuses a declared Content-Length over the limit without reading the body', async () => {
    const request = new Request('https://mcp.test/mcp', {
      method: 'POST',
      headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
      body: JSON.stringify(call(1)),
    })

    const result = await refuseBatch(request)

    expect('refused' in result).toBe(true)
    if (!('refused' in result)) return
    expect(result.refused.status).toBe(413)
    await expect(result.refused.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000 },
    })
    expect(request.bodyUsed).toBe(false)
  })

  it('stops reading a streamed body with no Content-Length once it passes the limit', async () => {
    const chunk = new Uint8Array(16 * 1024).fill(0x20)
    const chunksInTheLimit = Math.ceil(MAX_BODY_BYTES / chunk.byteLength)
    const chunksInTheBody = 64
    let pulled = 0
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1
          if (pulled > chunksInTheBody) controller.close()
          else controller.enqueue(chunk)
        },
      },
      { highWaterMark: 0 },
    )
    const request = new Request('https://mcp.test/mcp', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit)
    expect(request.headers.get('content-length')).toBeNull()

    const result = await refuseBatch(request)

    expect('refused' in result).toBe(true)
    if (!('refused' in result)) return
    expect(result.refused.status).toBe(413)
    expect(pulled).toBeLessThanOrEqual(chunksInTheLimit + 2)
  })

  it('parses a body of exactly the limit', async () => {
    const message = messageOf(MAX_BODY_BYTES)
    expect(new TextEncoder().encode(message).byteLength).toBe(MAX_BODY_BYTES)

    const result = await refuseBatch(post(message))

    expect(result).toEqual({ parsedBody: JSON.parse(message) })
  })

  it('refuses a body one byte over the limit', async () => {
    const result = await refuseBatch(post(messageOf(MAX_BODY_BYTES + 1)))

    expect('refused' in result).toBe(true)
    if (!('refused' in result)) return
    expect(result.refused.status).toBe(413)
  })
})
