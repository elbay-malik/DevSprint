import { describe, expect, it, vi } from 'vitest'
import { TOOL_DESCRIPTIONS } from '@devsprint/shared/tools'
import {
  adaptRemoteTools,
  createMcpIssueTools,
  MCP_ISSUE_TOOL_NAMES,
  unwrapEnvelope,
} from './mcp-tools'

/** A minimal MCP server over fetch: enough for initialize and tools/call. */
function fakeMcpServer(onCall: (name: string, args: unknown) => unknown) {
  const calls: { name: string; args: unknown }[] = []
  const fetchImpl = vi.fn((_input: unknown, init?: { body?: unknown }) => {
    const message = JSON.parse(String(init?.body)) as {
      id?: number
      method: string
      params?: { name: string; arguments: unknown }
    }
    const reply = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), {
        headers: { 'Content-Type': 'application/json' },
      })

    if (message.method === 'initialize') {
      return reply({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake', version: '1.0.0' },
      })
    }
    if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params!
      calls.push({ name, args })
      return reply({ content: [{ type: 'text', text: JSON.stringify(onCall(name, args)) }] })
    }
    return new Response(null, { status: 202 })
  })
  return { fetch: fetchImpl as unknown as typeof globalThis.fetch, calls }
}

describe('unwrapEnvelope', () => {
  it('recovers the shared envelope from an MCP result', () => {
    const wrapped = { content: [{ type: 'text', text: '{"ok":true,"data":{"issues":[]}}' }] }
    expect(unwrapEnvelope(wrapped)).toEqual({ ok: true, data: { issues: [] } })
  })

  it('keeps a domain failure a readable value', () => {
    const wrapped = {
      content: [{ type: 'text', text: '{"ok":false,"error":{"code":"ISSUE_NOT_FOUND"}}' }],
    }
    expect(unwrapEnvelope(wrapped)).toMatchObject({ ok: false, error: { code: 'ISSUE_NOT_FOUND' } })
  })

  it('rejects valid JSON that is not our envelope', () => {
    // The failure this guards is quiet: `.ok` would read undefined, the cards
    // would render nothing, and the model would still answer plausibly.
    for (const text of ['{"issues":[]}', '{"ok":"yes"}', '{"ok":false}', 'null', '[]']) {
      expect(unwrapEnvelope({ content: [{ type: 'text', text }] })).toMatchObject({ ok: false })
    }
  })

  it('reports a malformed result rather than passing it on', () => {
    // Without this the SPA's `result.ok` reads undefined and the cards render
    // nothing, while the model still answers plausibly — a silent failure.
    expect(unwrapEnvelope({ content: [] })).toMatchObject({ ok: false })
    expect(unwrapEnvelope({ content: [{ type: 'text', text: 'not json' }] })).toMatchObject({
      ok: false,
    })
    expect(unwrapEnvelope(undefined)).toMatchObject({ ok: false })
  })
})

describe('createMcpIssueTools', () => {
  it('builds exactly the four issue tools', async () => {
    const server = fakeMcpServer(() => ({ ok: true, data: {} }))
    const tools = await createMcpIssueTools({ fetch: server.fetch })

    expect(Object.keys(tools).sort()).toEqual([...MCP_ISSUE_TOOL_NAMES].sort())
  })

  it('keeps the write tools gated (ADR-0003 survives the MCP hop)', async () => {
    const server = fakeMcpServer(() => ({ ok: true, data: {} }))
    const tools = await createMcpIssueTools({ fetch: server.fetch })

    expect(tools.create_issue?.needsApproval).toBe(true)
    expect(tools.update_issue_status?.needsApproval).toBe(true)
    // Reads must not sprout a gate just because they arrive over MCP.
    expect(tools.list_issues?.needsApproval).toBeUndefined()
    expect(tools.search_issues?.needsApproval).toBeUndefined()
  })

  it('is a static tool, not a dynamic one', async () => {
    const server = fakeMcpServer(() => ({ ok: true, data: {} }))
    const tools = await createMcpIssueTools({ fetch: server.fetch })

    // Without our schemas the SDK builds dynamicTool()s, which reach the UI as
    // `dynamic-tool` parts instead of `tool-<name>` and break the chip.
    expect(tools.list_issues?.type).not.toBe('dynamic')
    expect(tools.list_issues?.inputSchema).toBeDefined()
  })

  it('carries the descriptions the tool inventory defines', async () => {
    const server = fakeMcpServer(() => ({ ok: true, data: {} }))
    const tools = await createMcpIssueTools({ fetch: server.fetch })

    for (const name of MCP_ISSUE_TOOL_NAMES) {
      expect(tools[name]?.description).toBe(TOOL_DESCRIPTIONS[name])
    }
  })

  it('returns the envelope, not the MCP wrapper, when a tool runs', async () => {
    const server = fakeMcpServer((name) =>
      name === 'list_issues'
        ? { ok: true, data: { issues: [{ key: 'DS-7' }] } }
        : { ok: false, error: { code: 'INVALID_INPUT', message: 'no' } },
    )
    const tools = await createMcpIssueTools({ fetch: server.fetch })

    const result = await tools.list_issues!.execute!(
      { limit: 50 },
      { toolCallId: 'c1', messages: [] },
    )

    expect(result).toEqual({ ok: true, data: { issues: [{ key: 'DS-7' }] } })
    expect(server.calls[0]?.name).toBe('list_issues')
  })

  it('needs no tools/list round trip — the definitions are vendored', async () => {
    const server = fakeMcpServer(() => ({ ok: true, data: {} }))
    await createMcpIssueTools({ fetch: server.fetch })

    const mocked = server.fetch as unknown as { mock: { calls: [unknown, { body?: unknown }][] } }
    const sent = mocked.mock.calls
      .map((call) => call[1]?.body)
      .filter((body): body is string => typeof body === 'string')
      .map((body) => (JSON.parse(body) as { method: string }).method)
    // A server that is slow or briefly down cannot change what the agent can do.
    expect(sent).not.toContain('tools/list')
  })
})

describe('adaptRemoteTools', () => {
  const usable = { execute: () => Promise.resolve({ content: [{ type: 'text', text: '{}' }] }) }

  it('fails while building when the server omits a tool', () => {
    // A definition mismatch or an SDK change should reach the caller's fallback
    // here, rather than surfacing mid-turn as a broken tool call.
    expect(() => adaptRemoteTools({ list_issues: usable })).toThrow(/usable 'search_issues'/)
  })

  it('fails while building when a tool cannot be executed', () => {
    const remote = Object.fromEntries(MCP_ISSUE_TOOL_NAMES.map((name) => [name, usable]))
    expect(() =>
      adaptRemoteTools({ ...remote, create_issue: { description: 'no execute' } }),
    ).toThrow(/usable 'create_issue'/)
  })
})
