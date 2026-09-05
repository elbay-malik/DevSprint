import { describe, expect, it } from 'vitest'
import { READ_TOOL_NAMES, TOOL_DESCRIPTIONS } from '@devsprint/shared/tools'
import { createWorkspaceStore } from '../workspace/store'
import { createReadTools } from './tools'

const store = createWorkspaceStore()
const tools = createReadTools(store)

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

  it('never registers a write tool before the Phase 5 approval gates', () => {
    for (const write of [
      'create_issue',
      'update_issue_status',
      'create_release_notes',
      'run_deployment',
    ]) {
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
    const live = createReadTools(mutable)
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
