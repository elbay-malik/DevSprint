import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { getBurndown, getSprintStatus } from '../workspace/queries'
import { planUserText, routeUserText, scriptChunks, summarizeToolOutput } from './mock-model'
import { buildSystemPrompt } from './system-prompt'

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

  it('passes the sprint the user named, exactly as the scenarios spell it', () => {
    const [status] = planUserText('Summarize Sprint 12 and draft release notes.', ALL_TOOLS)
    expect(status).toMatchObject({ input: { sprintId: 'sprint-12' } })
    // No sprint named means the tool's own default, not a guessed one.
    const [current] = planUserText('How is the sprint going?', ALL_TOOLS)
    expect(current).toMatchObject({ toolName: 'get_sprint_status', input: {} })
  })

  it('reads the chart and the blockers for an "on track?" question (S-D)', () => {
    // "Show me the burndown" used to plan a list of every issue too, through
    // the bare "show". The blockers are the read the narration actually needs.
    const plan = planUserText('Is Sprint 12 on track? Show me the burndown.', ALL_TOOLS)
    expect(plan).toEqual([
      { kind: 'tool-call', toolName: 'get_burndown', input: { sprintId: 'sprint-12' } },
      {
        kind: 'tool-call',
        toolName: 'list_issues',
        input: { sprintId: 'sprint-12', status: 'blocked' },
      },
    ])
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
    // At 2026-07-01 the ideal line is at 9.54 and the sprint at 23; the last
    // bucket would read 23 behind. The gap is rounded to whole points.
    const summary = summarizeToolOutput('get_burndown', getBurndown(workspace, {}))
    expect(summary).toBe('8 of 31 points done, behind the ideal line by 13 points.')
  })

  it('says a failure in words and leaves the code to the error card', () => {
    const summary = summarizeToolOutput(
      'list_issues',
      {
        ok: false,
        error: {
          code: 'SPRINT_NOT_FOUND',
          message: "No sprint with id 'sprint-99'. Known sprints: sprint-11, sprint-12.",
        },
      },
      { sprintId: 'sprint-99' },
    )
    // One plain sentence, not the api's model-facing list of ids to pick from.
    expect(summary).toBe('There is no sprint sprint-99.')
    expect(summary).not.toContain('list_issues')
    expect(summary).not.toContain('Known sprints')
  })

  it('says a failed deployment write without the api’s wording', () => {
    const summary = summarizeToolOutput(
      'run_deployment',
      {
        ok: false,
        error: { code: 'VERSION_EXISTS', message: "Version 'v1.4.2' was already deployed." },
      },
      { version: 'v1.4.2', environment: 'production' },
    )
    expect(summary).toBe('v1.4.2 is already live in production.')
  })

  it('names statuses by their board labels, never the enum', () => {
    const issue = workspace.issues.find((candidate) => candidate.key === 'DS-7')!
    const summary = summarizeToolOutput('update_issue_status', {
      ok: true,
      data: { issue: { ...issue, status: 'done' }, previousStatus: 'in_review' },
    })
    expect(summary).toBe('DS-7 is now Done.')
    expect(summary).not.toMatch(/in_review|\bdone\b/)
  })

  it('gives the issue table a takeaway instead of reading its rows back', () => {
    const issues = workspace.issues.filter((issue) => issue.sprintId === 'sprint-12')
    const summary = summarizeToolOutput('list_issues', { ok: true, data: { issues } })
    expect(summary).toBe('7 issues, 31 points. Blocked: DS-11.')
    // Only blocked issues: the count would just repeat the risk.
    const blocked = issues.filter((issue) => issue.status === 'blocked')
    expect(summarizeToolOutput('list_issues', { ok: true, data: { issues: blocked } })).toBe(
      'Blocked: DS-11.',
    )
  })

  it('names only the best search match, which the table already ranks', () => {
    const summary = summarizeToolOutput('search_issues', {
      ok: true,
      data: {
        matches: [
          { key: 'DS-7', title: 'Billing export CSV download', status: 'in_review', score: 0.56 },
          { key: 'DS-3', title: 'Billing page layout', status: 'done', score: 0.11 },
        ],
      },
    })
    expect(summary).toBe('Best match: DS-7, “Billing export CSV download”.')
    expect(summary).not.toMatch(/score|0\.56|in_review/)
  })

  it('sizes a release-notes diff and says what comes next', () => {
    const summary = summarizeToolOutput('diff_release_notes', {
      ok: true,
      data: {
        baseVersion: 'v1.4.2',
        before: '',
        after: '',
        changedSections: [
          { heading: 'Shipped', changeType: 'added' },
          { heading: 'Fixed', changeType: 'removed' },
        ],
      },
    })
    expect(summary).toBe(
      'The draft changes 2 sections against v1.4.2. Ask me to save it when it reads right.',
    )
  })

  it('reports a deployment by its outcome, not its stages', () => {
    const run = (status: string) =>
      summarizeToolOutput('run_deployment', {
        ok: true,
        data: {
          deployment: { version: 'v1.5.0-rc.1', environment: 'staging', status, stages: [] },
        },
      })
    expect(run('succeeded')).toBe('Released v1.5.0-rc.1 to staging.')
    expect(run('cancelled')).toBe('v1.5.0-rc.1 was not released to staging: the run was cancelled.')
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

describe('assigning an issue — read first, then the gated write', () => {
  const ASSIGN_TOOLS = new Set([...ALL_TOOLS, 'update_issue_status', 'assign_issue'])
  const SYSTEM = buildSystemPrompt(createWorkspaceSeed())

  /** The turn after the grounding search came back with `matches`. */
  function afterSearch(text: string, matches: Array<{ key: string; title: string }>) {
    return scriptChunks({
      prompt: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [{ type: 'text', text }] },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 's1', toolName: 'search_issues', input: {} }],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 's1',
              toolName: 'search_issues',
              output: {
                type: 'json',
                value: {
                  ok: true,
                  data: { matches: matches.map((m) => ({ ...m, status: 'todo', score: 1 })) },
                },
              },
            },
          ],
        },
      ],
      tools: [...ASSIGN_TOOLS].map((name) => ({
        type: 'function',
        name,
        inputSchema: { type: 'object' },
      })),
    } as never)
  }

  function callOf(chunks: ReturnType<typeof scriptChunks>) {
    const call = chunks.find((chunk) => chunk.type === 'tool-call') as
      { toolName: string; input: string } | undefined
    return call && { toolName: call.toolName, input: JSON.parse(call.input) as unknown }
  }

  function textOf(chunks: ReturnType<typeof scriptChunks>) {
    return chunks.map((chunk) => (chunk.type === 'text-delta' ? chunk.delta : '')).join('')
  }

  const DS_12 = [{ key: 'DS-12', title: 'Dark mode theme audit' }]

  it('opens with a read of the named key, not a write', () => {
    expect(planUserText('Assign DS-12 to Dana', ASSIGN_TOOLS)).toEqual([
      { kind: 'tool-call', toolName: 'search_issues', input: { query: 'DS-12' } },
    ])
  })

  it('resolves the person from the roster the system prompt lists', () => {
    for (const text of [
      'Assign DS-12 to Dana',
      'assign ds-12 to @dana',
      'Hand DS-12 to Dana Petrova',
    ]) {
      expect(callOf(afterSearch(text, DS_12)), text).toEqual({
        toolName: 'assign_issue',
        input: { issueKey: 'DS-12', assigneeId: 'u-dana' },
      })
    }
  })

  it('unassigns with null', () => {
    expect(callOf(afterSearch('Unassign DS-12', DS_12))).toEqual({
      toolName: 'assign_issue',
      input: { issueKey: 'DS-12', assigneeId: null },
    })
  })

  it('asks rather than inventing an id for someone the roster does not have', () => {
    const chunks = afterSearch('Assign DS-12 to Zoe', DS_12)
    expect(callOf(chunks)).toBeUndefined()
    expect(textOf(chunks)).toBe('No one on the team goes by that name. Who should DS-12 go to?')
  })

  it('writes nothing for a key the search did not find', () => {
    const chunks = afterSearch('Assign DS-42 to Dana', [])
    expect(callOf(chunks)).toBeUndefined()
    expect(textOf(chunks)).toBe('No matching issues.')
  })

  it('reports the change by @handle, and an unassignment as such', () => {
    const issue = createWorkspaceSeed().issues.find((candidate) => candidate.key === 'DS-12')!
    const handles = new Map([['u-dana', 'dana']])
    const result = (assigneeId: string | null) => ({
      ok: true,
      data: { issue: { ...issue, assigneeId }, previousAssigneeId: 'u-ben' },
    })
    expect(summarizeToolOutput('assign_issue', result('u-dana'), undefined, handles)).toBe(
      'DS-12 is now assigned to @dana.',
    )
    expect(summarizeToolOutput('assign_issue', result(null), undefined, handles)).toBe(
      'DS-12 is now unassigned.',
    )
    expect(
      summarizeToolOutput(
        'assign_issue',
        { ok: false, error: { code: 'INVALID_INPUT', message: 'already' } },
        { issueKey: 'DS-11', assigneeId: 'u-dana' },
      ),
    ).toBe('DS-11 already has that assignee.')
  })

  describe('a tool that failed unexpectedly', () => {
    const answerTo = (code: string, toolName = 'assign_issue') =>
      scriptChunks({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Assign DS-12 to Dana' }] },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'c1',
                toolName,
                input: { issueKey: 'DS-12', assigneeId: 'u-dana' },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'c1',
                toolName,
                output: { type: 'json', value: { ok: false, error: { code, message: 'no' } } },
              },
            ],
          },
        ],
        tools: [...ASSIGN_TOOLS].map((name) => ({
          type: 'function',
          name,
          inputSchema: { type: 'object' },
        })),
      } as never)
        .flatMap((chunk) => (chunk.type === 'text-delta' ? [chunk.delta] : []))
        .join('')

    it('says the outcome is unknown rather than that nothing changed', () => {
      expect(answerTo('INTERNAL')).toBe(
        'The board couldn’t be reached, so this may not have saved. Check the board before trying again.',
      )
    })

    it('tells a failed read to try again, since a read changes nothing', () => {
      expect(answerTo('INTERNAL', 'list_issues')).toBe(
        'The board couldn’t be reached. Try again in a moment.',
      )
    })

    it('still says nothing changed after a refusal', () => {
      expect(answerTo('WORKSPACE_FULL')).toBe(
        'The board is full; a reset clears it. Nothing changed.',
      )
    })
  })

  it('leaves the status-change route as it was', () => {
    expect(planUserText('Mark DS-12 as done', ASSIGN_TOOLS)).toEqual([
      {
        kind: 'tool-call',
        toolName: 'update_issue_status',
        input: { issueKey: 'DS-12', status: 'done' },
      },
    ])
  })
})
