import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import type { WorkspaceApi } from '@devsprint/shared/tools'
import { MAX_BODY_BYTES, refuseBatch } from './batch'
import { handleMcpRequest, MAX_TOOL_INPUT_ELEMENTS } from './mcp'

/** Only the write these tests reach; the real server and transport do the rest. */
function fakeWorkspace() {
  const issue = createWorkspaceSeed().issues[0]!
  const createIssue = vi.fn(() => Promise.resolve({ ok: true as const, data: { issue } }))
  return { createIssue, api: { createIssue } as unknown as WorkspaceApi }
}

function post(body: string) {
  return new Request('https://mcp.test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body,
  })
}

const createIssueCall = (args: Record<string, unknown>) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'create_issue', arguments: { title: 'a title', type: 'bug', ...args } },
  })

/** The first JSON-RPC message of the SSE response the transport answers with. */
async function resultOf(response: Response) {
  expect(response.status).toBe(200)
  const data = (await response.text()).split('\n').find((line) => line.startsWith('data: '))
  return (
    JSON.parse(data!.slice('data: '.length)) as {
      result: { isError?: boolean; content: { text: string }[] }
    }
  ).result
}

/**
 * The public entrypoint's order: `refuseBatch` reads the body, so the transport
 * can only get it through `parsedBody`. Sharing one request is the point.
 */
async function handleAfterRefuseBatch(body: string, api: WorkspaceApi) {
  const request = post(body)
  const read = await refuseBatch(request)
  if (!('parsedBody' in read)) throw new Error('the body was refused')
  expect(request.bodyUsed).toBe(true)
  return await handleMcpRequest(request, api, read.parsedBody)
}

describe('handleMcpRequest', () => {
  it('refuses a tool call with too many elements before it reaches the workspace', async () => {
    const { api, createIssue } = fakeWorkspace()
    const labels = Array.from({ length: MAX_TOOL_INPUT_ELEMENTS + 50 }, (_, i) => `l${i}`)

    const result = await resultOf(await handleMcpRequest(post(createIssueCall({ labels })), api))

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain(
      `more than the maximum of ${MAX_TOOL_INPUT_ELEMENTS} elements`,
    )
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('applies the element limit to a body the public entrypoint already parsed', async () => {
    const { api, createIssue } = fakeWorkspace()
    const labels = Array.from({ length: MAX_TOOL_INPUT_ELEMENTS + 50 }, (_, i) => `l${i}`)

    const result = await resultOf(await handleAfterRefuseBatch(createIssueCall({ labels }), api))

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('more than the maximum')
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('still runs a call with the most labels the schema allows', async () => {
    const { api, createIssue } = fakeWorkspace()
    const labels = Array.from({ length: 10 }, (_, i) => `l${i}`)

    const result = await resultOf(await handleMcpRequest(post(createIssueCall({ labels })), api))

    expect(result.isError).toBeUndefined()
    expect(createIssue).toHaveBeenCalledOnce()
  })

  it('answers 413 when it reads an oversized body itself, as the Internal entrypoint does', async () => {
    const { api, createIssue } = fakeWorkspace()
    const description = 'x'.repeat(MAX_BODY_BYTES)

    const response = await handleMcpRequest(post(createIssueCall({ description })), api)

    expect(response.status).toBe(413)
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('leaves room for the costliest legitimate call on the public path', async () => {
    const { api, createIssue } = fakeWorkspace()
    // Every character at a schema limit, each sent as a six-byte JSON escape.
    const body = createIssueCall({
      title: 'é'.repeat(200),
      description: 'é'.repeat(4000),
      labels: Array.from({ length: 10 }, () => 'é'.repeat(40)),
      sprintId: 'é'.repeat(64),
      assigneeId: 'é'.repeat(64),
      points: 100,
      priority: 'medium',
    }).replaceAll('é', '\\u00e9')

    const result = await resultOf(await handleAfterRefuseBatch(body, api))

    expect(result.isError).toBeUndefined()
    expect(createIssue).toHaveBeenCalledOnce()
  })
})
