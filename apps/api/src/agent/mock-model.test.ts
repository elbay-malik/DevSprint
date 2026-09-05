import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { getBurndown, getSprintStatus } from '../workspace/queries'
import { planUserText, routeUserText, summarizeToolOutput } from './mock-model'

const ALL_TOOLS = new Set([
  'list_issues',
  'search_issues',
  'get_sprint_status',
  'get_deployment_history',
  'get_burndown',
  'diff_release_notes',
])

describe('routeUserText', () => {
  it('answers sprint questions with get_sprint_status by default', () => {
    expect(routeUserText('How many open issues are in the current sprint?', ALL_TOOLS)).toEqual({
      kind: 'tool-call',
      toolName: 'get_sprint_status',
      input: {},
    })
  })

  it('routes deploy, burndown and search phrasings to their tools', () => {
    expect(routeUserText('What did we deploy last?', ALL_TOOLS)).toEqual({
      kind: 'tool-call',
      toolName: 'get_deployment_history',
      input: {},
    })
    expect(routeUserText('Is Sprint 12 on track? Show me the burndown.', ALL_TOOLS)).toMatchObject({
      toolName: 'get_burndown',
    })
    expect(routeUserText('Find the billing export issue', ALL_TOOLS)).toMatchObject({
      toolName: 'search_issues',
      input: { query: 'the billing export issue' },
    })
  })

  it('picks the environment out of a deploy question', () => {
    expect(routeUserText('What did we deploy to staging recently?', ALL_TOOLS)).toMatchObject({
      toolName: 'get_deployment_history',
      input: { environment: 'staging' },
    })
    expect(routeUserText('Has v1.4.2 shipped to production?', ALL_TOOLS)).toMatchObject({
      input: { environment: 'production' },
    })
  })

  it('passes a status filter through to list_issues', () => {
    expect(routeUserText('Show me the blocked issues', ALL_TOOLS)).toEqual({
      kind: 'tool-call',
      toolName: 'list_issues',
      input: { sprintId: 'sprint-12', status: 'blocked' },
    })
  })

  it('only picks tools the caller registered', () => {
    expect(routeUserText('What did we deploy last?', new Set(['get_sprint_status']))).toMatchObject(
      {
        toolName: 'get_sprint_status',
      },
    )
    expect(routeUserText('anything', new Set())).toMatchObject({ kind: 'text' })
  })
})

describe('planUserText', () => {
  it('plans a single tool for a single question', () => {
    expect(planUserText('How many open issues are in the current sprint?', ALL_TOOLS)).toEqual([
      { kind: 'tool-call', toolName: 'get_sprint_status', input: {} },
    ])
  })

  it('chains the sprint then the shipped work for release notes (S-A)', () => {
    const plan = planUserText('Summarize Sprint 12 and draft release notes for v1.5.0.', ALL_TOOLS)
    expect(plan.map((step) => ('toolName' in step ? step.toolName : step.kind))).toEqual([
      'get_sprint_status',
      'list_issues',
    ])
    expect(plan[1]).toMatchObject({ input: { sprintId: 'sprint-12', status: 'done' } })
  })

  it('chains a tool per question in a compound ask', () => {
    const plan = planUserText(
      'Is Sprint 12 on track? Show me the burndown and the blocked issues.',
      ALL_TOOLS,
    )
    expect(plan.map((step) => ('toolName' in step ? step.toolName : ''))).toEqual([
      'get_burndown',
      'list_issues',
    ])
  })

  it('never repeats a tool or exceeds three steps', () => {
    const plan = planUserText(
      'Summarize the sprint, show release notes, list the issues, the burndown, and what we deployed',
      ALL_TOOLS,
    )
    const names = plan.map((step) => ('toolName' in step ? step.toolName : ''))
    expect(names.length).toBeLessThanOrEqual(3)
    expect(new Set(names).size).toBe(names.length)
  })

  it('plans only what the caller registered', () => {
    const plan = planUserText(
      'Show me the burndown and the blocked issues',
      new Set(['list_issues']),
    )
    expect(plan.map((step) => ('toolName' in step ? step.toolName : ''))).toEqual(['list_issues'])
    expect(planUserText('anything', new Set())).toEqual([
      {
        kind: 'text',
        text: 'None of the tools I know how to use are registered in this session.',
      },
    ])
  })
})

describe('summarizeToolOutput', () => {
  const workspace = createWorkspaceSeed()

  it('grounds the sprint summary in the tool result', () => {
    const summary = summarizeToolOutput('get_sprint_status', getSprintStatus(workspace, {}))
    expect(summary).toContain('5 open issues')
    expect(summary).toContain('23 of 31 points remaining')
    expect(summary).toContain('4 days left')
    expect(summary).toContain('DS-11')
  })

  it('reads the burndown against the demo clock, not the last bucket', () => {
    const summary = summarizeToolOutput('get_burndown', getBurndown(workspace, {}))
    expect(summary).toContain('2026-07-01')
    expect(summary).toContain('behind the ideal line')
  })

  it('surfaces the error code of a failed call', () => {
    const summary = summarizeToolOutput('list_issues', {
      ok: false,
      error: { code: 'SPRINT_NOT_FOUND', message: "No sprint with id 'sprint-99'." },
    })
    expect(summary).toContain('SPRINT_NOT_FOUND')
    expect(summary).toContain('sprint-99')
  })

  it('does not crash on a non-envelope payload', () => {
    expect(summarizeToolOutput('list_issues', 'nonsense')).toContain('unexpected result')
  })
})
