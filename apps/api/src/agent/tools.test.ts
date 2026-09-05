import { describe, expect, it } from 'vitest'
import { READ_TOOL_NAMES, TOOL_DESCRIPTIONS, WRITE_TOOL_NAMES } from '@devsprint/shared/tools'
import { createLocalWorkspaceApi, createWorkspaceStore } from '../workspace/store'
import { createReadTools, createTools, createWriteTools } from './tools'

const store = createWorkspaceStore()
const tools = createReadTools(createLocalWorkspaceApi(store))

/** `execute` is optional on the SDK's Tool type; every tool here defines one. */
async function run(name: keyof typeof tools, input: unknown): Promise<unknown> {
  const execute = tools[name].execute
  if (!execute) throw new Error(`${name} has no execute`)
  return await execute(input as never, { toolCallId: 'test-call', messages: [] })
}

describe('createReadTools', () => {
  it('registers exactly the six read/rich-data tools', () => {
    expect(Object.keys(tools).sort()).toEqual([...READ_TOOL_NAMES].sort())
  })

  it('keeps the read set free of writes', () => {
    for (const write of [...WRITE_TOOL_NAMES, 'run_deployment']) {
      expect(Object.keys(tools)).not.toContain(write)
    }
  })

  it('uses the documented trigger descriptions verbatim', () => {
    for (const name of READ_TOOL_NAMES) {
      expect(tools[name].description).toBe(TOOL_DESCRIPTIONS[name])
    }
  })

  it('returns the shared result envelope', async () => {
    await expect(run('get_sprint_status', {})).resolves.toMatchObject({
      ok: true,
      data: { sprint: { id: 'sprint-12' } },
    })
    await expect(run('list_issues', { sprintId: 'sprint-99', limit: 50 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'SPRINT_NOT_FOUND' },
    })
  })

  it('reads the store on every call rather than a captured snapshot', async () => {
    const mutable = createWorkspaceStore()
    const live = createReadTools(createLocalWorkspaceApi(mutable))
    mutable.get().issues.push({
      ...mutable.get().issues[0]!,
      id: 'ds-99',
      key: 'DS-99',
      sprintId: 'sprint-12',
      status: 'todo',
      completedAt: null,
    })
    const execute = live.list_issues.execute
    const result = await execute!(
      { sprintId: 'sprint-12', limit: 50 },
      { toolCallId: 'test-call', messages: [] },
    )
    expect(JSON.stringify(result)).toContain('DS-99')
  })
})

describe('createWriteTools', () => {
  const writeTools = createWriteTools(createLocalWorkspaceApi(createWorkspaceStore()))

  it('registers the three gated writes and not the long-running one', () => {
    expect(Object.keys(writeTools).sort()).toEqual([...WRITE_TOOL_NAMES].sort())
    // run_deployment arrives with its simulation in Phase 8.
    expect(Object.keys(writeTools)).not.toContain('run_deployment')
  })

  it('gates every write', () => {
    // `needsApproval` is the entire gate: the SDK auto-executes a tool that
    // omits it, so a missing flag would silently let a write run unapproved.
    for (const name of WRITE_TOOL_NAMES) {
      expect(writeTools[name].needsApproval).toBe(true)
    }
  })

  it('gates no read', () => {
    const all = createTools(createLocalWorkspaceApi(createWorkspaceStore()))
    for (const name of READ_TOOL_NAMES) {
      expect(all[name].needsApproval).toBeUndefined()
    }
  })

  it('exposes reads and writes together to the agent', () => {
    const all = createTools(createLocalWorkspaceApi(createWorkspaceStore()))
    expect(Object.keys(all).sort()).toEqual([...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].sort())
  })
})
