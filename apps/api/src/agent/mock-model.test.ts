import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { getBurndown, getSprintStatus } from '../workspace/queries'
import { planUserText, routeUserText, scriptChunks, summarizeToolOutput } from './mock-model'

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

  it('asks for the draft instead of quietly summarising the sprint', () => {
    // "release notes" also matches the chain rule, so without an explicit guard
    // this question plans get_sprint_status and never mentions the comparison.
    for (const question of [
      'Compare the draft release notes against v1.4.2',
      'Diff the changelog for v1.5.0',
    ]) {
      const plan = planUserText(question, ALL_TOOLS)
      expect(plan).toHaveLength(1)
      expect(plan[0]).toMatchObject({ kind: 'text' })
      expect(plan[0]).toHaveProperty('text', expect.stringContaining('draft markdown'))
    }
  })

  it('lets a stray "compare" leave a real intent alone', () => {
    const plan = planUserText('Show me the burndown and compare it to the ideal line', ALL_TOOLS)
    expect(plan.map((step) => ('toolName' in step ? step.toolName : 'text'))).toContain(
      'get_burndown',
    )
    expect(plan.every((step) => step.kind === 'tool-call')).toBe(true)
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

describe('scenario S-E — a wrong key recovers by searching', () => {
  const WRITE_TOOLS = new Set([...ALL_TOOLS, 'update_issue_status'])
  const PROMPT = 'Mark DS-42 as done — the billing export shipped this morning.'

  it('reads the verbatim prompt as a status change, not a deploy question', () => {
    // "shipped" sits in the explanation, not the instruction. It used to drag
    // the whole turn to get_deployment_history, which meant S-E never ran.
    expect(planUserText(PROMPT, WRITE_TOOLS)).toEqual([
      {
        kind: 'tool-call',
        toolName: 'update_issue_status',
        input: { issueKey: 'DS-42', status: 'done' },
      },
    ])
  })

  it('searches for what the user meant once the key comes back not found', () => {
    // The state the agent is in after the approved write failed.
    const chunks = scriptChunks({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: PROMPT }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'update_issue_status',
              input: { issueKey: 'DS-42', status: 'done' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'update_issue_status',
              output: {
                type: 'json',
                value: {
                  ok: false,
                  error: { code: 'ISSUE_NOT_FOUND', message: "No issue with key 'DS-42'." },
                },
              },
            },
          ],
        },
      ],
      tools: [...WRITE_TOOLS].map((name) => ({
        type: 'function',
        name,
        inputSchema: { type: 'object' },
      })),
    } as never)

    const call = chunks.find((chunk) => chunk.type === 'tool-call')
    expect(call).toMatchObject({ toolName: 'search_issues' })
    // Grounded in the user's own words, minus the key that did not exist.
    expect(String((call as { input: string }).input)).toContain('billing export')
  })
})

describe('scenario S-A — draft, diff, then a gated save', () => {
  const S_A_TOOLS = new Set([...ALL_TOOLS, 'create_release_notes'])

  it('saves the draft the diff already showed, rather than composing a new one', () => {
    // Step 7: "Looks good, save it." carries no version and no markdown, so
    // the save has to come from the draft the previous turn produced — saving
    // anything else would persist something the user never saw.
    const draft = '## v1.5.0 — Sprint 12\n\n### Shipped\n\n- Billing export (DS-5)'
    const chunks = scriptChunks({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'draft release notes for v1.5.0' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: 'diff_release_notes',
              input: { draftMarkdown: draft },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'diff_release_notes',
              output: { type: 'json', value: { ok: true, data: { changedSections: [] } } },
            },
          ],
        },
        { role: 'user', content: [{ type: 'text', text: 'Looks good, save it.' }] },
      ],
      tools: [...S_A_TOOLS].map((name) => ({
        type: 'function',
        name,
        inputSchema: { type: 'object' },
      })),
    } as never)

    const call = chunks.find((chunk) => chunk.type === 'tool-call')
    expect(call).toMatchObject({ toolName: 'create_release_notes' })
    const input = JSON.parse(String((call as { input: string }).input)) as {
      version: string
      markdown: string
    }
    expect(input.version).toBe('v1.5.0')
    expect(input.markdown).toBe(draft)
  })
})
