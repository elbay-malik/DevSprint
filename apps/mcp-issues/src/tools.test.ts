import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import { TOOL_DESCRIPTIONS, type WorkspaceApi } from '@devsprint/shared/tools'
import { ISSUE_TOOL_NAMES, registerIssueTools } from './tools'

interface Registration {
  config: { description?: string; inputSchema?: unknown }
  handler: (input: unknown) => Promise<{ content: { type: string; text: string }[] }>
}

/** Records what the server was asked to register, without an MCP runtime. */
function fakeServer() {
  const registered = new Map<string, Registration>()
  const server = {
    registerTool: (
      name: string,
      config: Registration['config'],
      handler: Registration['handler'],
    ) => registered.set(name, { config, handler }),
  } as unknown as McpServer
  return { server, registered }
}

/** A workspace that records calls, so we can see exactly what reached it. */
function fakeWorkspace() {
  const workspace: Workspace = createWorkspaceSeed()
  const calls = {
    listIssues: vi.fn(() => Promise.resolve({ ok: true as const, data: { issues: [] } })),
    searchIssues: vi.fn(() => Promise.resolve({ ok: true as const, data: { matches: [] } })),
    createIssue: vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { issue: workspace.issues[0]! } }),
    ),
    updateIssueStatus: vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'ISSUE_NOT_FOUND' as const, message: 'nope' },
      }),
    ),
    assignIssue: vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'USER_NOT_FOUND' as const, message: 'nobody by that id' },
      }),
    ),
  }
  return { calls, api: calls as unknown as WorkspaceApi }
}

function parse(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>
}

/** A valid call to each tool, so each one gets as far as the workspace. */
const VALID_CALLS: [string, Record<string, unknown>][] = [
  ['list_issues', {}],
  ['search_issues', { query: 'visitor-text' }],
  ['create_issue', { title: 'visitor-text', type: 'bug' }],
  ['update_issue_status', { issueKey: 'DS-1', status: 'done' }],
  ['assign_issue', { issueKey: 'DS-1', assigneeId: null }],
]

/** A workspace whose every method does what `fail` does. */
function brokenWorkspace(fail: () => Promise<never>) {
  return {
    listIssues: fail,
    searchIssues: fail,
    createIssue: fail,
    updateIssueStatus: fail,
    assignIssue: fail,
  } as unknown as WorkspaceApi
}

describe('registerIssueTools', () => {
  it('exposes exactly the five issue tools (S-F eval assertion)', () => {
    const { server, registered } = fakeServer()
    registerIssueTools(server, fakeWorkspace().api)

    expect([...registered.keys()]).toEqual([
      'list_issues',
      'search_issues',
      'create_issue',
      'update_issue_status',
      'assign_issue',
    ])
    expect(ISSUE_TOOL_NAMES).toEqual([...registered.keys()])
  })

  it('publishes no tool the issues server does not own', () => {
    const { server, registered } = fakeServer()
    registerIssueTools(server, fakeWorkspace().api)

    for (const elsewhere of ['get_burndown', 'run_deployment', 'create_release_notes']) {
      expect(registered.has(elsewhere)).toBe(false)
    }
  })

  it('reuses the same descriptions the in-app agent sees', () => {
    const { server, registered } = fakeServer()
    registerIssueTools(server, fakeWorkspace().api)

    // One source of truth, so the contract cannot drift between the two clients.
    for (const name of ISSUE_TOOL_NAMES) {
      expect(registered.get(name)?.config.description).toBe(TOOL_DESCRIPTIONS[name])
    }
  })

  it('validates arguments even though the host owns the permission prompt', async () => {
    const { server, registered } = fakeServer()
    const workspace = fakeWorkspace()
    registerIssueTools(server, workspace.api)

    const result = await registered.get('update_issue_status')!.handler({ issueKey: 'DS-7' })

    expect(parse(result)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    // Nothing reached the workspace, so an invalid call cannot mutate anything.
    expect(workspace.calls.updateIssueStatus).not.toHaveBeenCalled()
  })

  it('refuses text the board would store as escapes', async () => {
    // A control character serializes as a six-character `\u0001`, so it let a
    // few public creates fill the board for everyone (ADR-0024).
    const { server, registered } = fakeServer()
    const workspace = fakeWorkspace()
    registerIssueTools(server, workspace.api)

    const controls = await registered
      .get('create_issue')!
      .handler({ title: '\u0001'.repeat(200), type: 'bug' })
    const surrogate = await registered
      .get('create_issue')!
      .handler({ title: 'ok', description: 'half a pair \uD800', type: 'bug' })
    const prose = await registered
      .get('create_issue')!
      .handler({ title: 'Fix it', description: 'line one\n\tline two 🚀', type: 'bug' })

    expect(parse(controls)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(parse(surrogate)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    // Tabs, newlines and whole emoji are ordinary text and still go through.
    expect(workspace.calls.createIssue).toHaveBeenCalledTimes(1)
    expect(parse(prose).ok).toBe(true)
  })

  it('applies the schema defaults before the call', async () => {
    const { server, registered } = fakeServer()
    const workspace = fakeWorkspace()
    registerIssueTools(server, workspace.api)

    await registered.get('create_issue')!.handler({ title: 'New', type: 'chore' })

    expect(workspace.calls.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'medium', sprintId: null }),
    )
  })

  it('carries the shared result envelope, success and failure alike', async () => {
    const { server, registered } = fakeServer()
    registerIssueTools(server, fakeWorkspace().api)

    const created = await registered.get('create_issue')!.handler({ title: 'x', type: 'bug' })
    expect(parse(created).ok).toBe(true)

    // A domain failure stays a readable value rather than becoming a protocol
    // error, which is what lets an external host recover from it.
    const missing = await registered
      .get('update_issue_status')!
      .handler({ issueKey: 'DS-99', status: 'done' })
    expect(parse(missing)).toMatchObject({ ok: false, error: { code: 'ISSUE_NOT_FOUND' } })
  })

  it('passes an assignment through, null included, and returns its refusal as a value', async () => {
    const { server, registered } = fakeServer()
    const workspace = fakeWorkspace()
    registerIssueTools(server, workspace.api)
    const assign = registered.get('assign_issue')!

    const unknown = await assign.handler({ issueKey: 'DS-12', assigneeId: 'u-zoe' })
    await assign.handler({ issueKey: 'DS-11', assigneeId: null })

    expect(parse(unknown)).toMatchObject({ ok: false, error: { code: 'USER_NOT_FOUND' } })
    expect(workspace.calls.assignIssue).toHaveBeenNthCalledWith(2, {
      issueKey: 'DS-11',
      assigneeId: null,
    })
    // No assignee at all is not "nobody": it never reaches the workspace.
    const missing = await assign.handler({ issueKey: 'DS-12' })
    expect(parse(missing)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(workspace.calls.assignIssue).toHaveBeenCalledTimes(2)
  })

  describe('when the workspace fails unexpectedly', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it.each(VALID_CALLS)('%s answers INTERNAL and keeps the message back', async (name, args) => {
      const { server, registered } = fakeServer()
      registerIssueTools(
        server,
        brokenWorkspace(() => Promise.reject(new Error('secret internals'))),
      )

      const result = await registered.get(name)!.handler(args)

      expect(parse(result)).toEqual({
        ok: false,
        error: { code: 'INTERNAL', message: 'The workspace is unavailable, try again.' },
      })
      expect(result.content[0]!.text).not.toContain('secret internals')
    })

    it('logs the tool and the detail, but not the arguments', async () => {
      const { server, registered } = fakeServer()
      registerIssueTools(
        server,
        brokenWorkspace(() => Promise.reject(new Error('secret internals'))),
      )

      await registered.get('create_issue')!.handler({ title: 'visitor-text', type: 'bug' })

      const logged = vi.mocked(console.error).mock.calls.map(([line]) => String(line))
      expect(logged).toHaveLength(1)
      expect(JSON.parse(logged[0]!)).toEqual({
        event: 'tool-failed',
        tool: 'create_issue',
        error: 'secret internals',
      })
      expect(logged[0]).not.toContain('visitor-text')
    })

    it('catches a method that throws before it returns a promise', async () => {
      const { server, registered } = fakeServer()
      registerIssueTools(
        server,
        brokenWorkspace(() => {
          throw new Error('secret internals')
        }),
      )

      const result = await registered.get('list_issues')!.handler({})

      expect(parse(result)).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    })

    it('logs a rejection that is not an Error', async () => {
      const { server, registered } = fakeServer()
      registerIssueTools(
        server,
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        brokenWorkspace(() => Promise.reject('plain text')),
      )

      await registered.get('list_issues')!.handler({})

      expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0]![0]))).toMatchObject({
        error: 'plain text',
      })
    })

    it('leaves a domain failure alone, with nothing logged', async () => {
      const { server, registered } = fakeServer()
      registerIssueTools(server, fakeWorkspace().api)

      const missing = await registered
        .get('update_issue_status')!
        .handler({ issueKey: 'DS-99', status: 'done' })

      expect(parse(missing)).toMatchObject({ ok: false, error: { code: 'ISSUE_NOT_FOUND' } })
      expect(console.error).not.toHaveBeenCalled()
    })
  })
})
