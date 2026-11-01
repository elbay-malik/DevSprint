import { describe, expect, it } from 'vitest'
import {
  READ_TOOL_INPUT_SCHEMAS,
  READ_TOOL_NAMES,
  TOOL_DESCRIPTIONS,
  WRITE_TOOL_INPUT_SCHEMAS,
  WRITE_TOOL_NAMES,
  getDeploymentHistoryInputSchema,
  listIssuesInputSchema,
  searchIssuesInputSchema,
} from '../src/tools'

/** docs/tool-inventory.md §2 — the read/query and rich-data tools shipped in Phase 3. */
describe('tool contracts', () => {
  it('covers exactly the six read/query and rich-data tools', () => {
    expect([...READ_TOOL_NAMES]).toEqual([
      'list_issues',
      'search_issues',
      'get_sprint_status',
      'get_deployment_history',
      'get_burndown',
      'diff_release_notes',
    ])
    expect(Object.keys(READ_TOOL_INPUT_SCHEMAS).sort()).toEqual([...READ_TOOL_NAMES].sort())
  })

  it('gates every tool that changes the workspace, deploys included', () => {
    expect([...WRITE_TOOL_NAMES]).toEqual([
      'create_issue',
      'update_issue_status',
      'create_release_notes',
      'run_deployment',
      'assign_issue',
    ])
    expect(Object.keys(WRITE_TOOL_INPUT_SCHEMAS).sort()).toEqual([...WRITE_TOOL_NAMES].sort())
    expect(Object.keys(TOOL_DESCRIPTIONS).sort()).toEqual(
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].sort(),
    )
  })

  it('keeps a status change single-issue so one approval cannot authorise many', () => {
    const schema = WRITE_TOOL_INPUT_SCHEMAS.update_issue_status
    expect(schema.safeParse({ issueKey: 'DS-7', status: 'done' }).success).toBe(true)
    expect(schema.safeParse({ issueKey: ['DS-7', 'DS-8'], status: 'done' }).success).toBe(false)
  })

  it('keeps an assignment single-issue, and lets null mean unassign', () => {
    const schema = WRITE_TOOL_INPUT_SCHEMAS.assign_issue
    expect(schema.safeParse({ issueKey: 'DS-12', assigneeId: 'u-dana' }).success).toBe(true)
    expect(schema.safeParse({ issueKey: 'DS-12', assigneeId: null }).success).toBe(true)
    // Leaving the assignee out is not a way to say "nobody": it has to be explicit.
    expect(schema.safeParse({ issueKey: 'DS-12' }).success).toBe(false)
    expect(schema.safeParse({ issueKey: ['DS-7', 'DS-8'], assigneeId: 'u-dana' }).success).toBe(
      false,
    )
    expect(schema.safeParse({ issueKey: 'DS-12', assigneeId: 'u-'.repeat(100) }).success).toBe(
      false,
    )
  })

  it('writes descriptions as trigger conditions', () => {
    for (const name of [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES]) {
      expect(TOOL_DESCRIPTIONS[name]).toMatch(/^Use when the user/)
    }
  })

  it('applies the documented defaults', () => {
    expect(listIssuesInputSchema.parse({})).toEqual({ limit: 50 })
    expect(searchIssuesInputSchema.parse({ query: 'billing export' })).toEqual({
      query: 'billing export',
      limit: 10,
    })
    expect(getDeploymentHistoryInputSchema.parse({})).toEqual({ limit: 5 })
  })

  it('rejects out-of-domain values', () => {
    expect(listIssuesInputSchema.safeParse({ status: 'archived' }).success).toBe(false)
    expect(listIssuesInputSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(searchIssuesInputSchema.safeParse({ query: '' }).success).toBe(false)
    expect(getDeploymentHistoryInputSchema.safeParse({ environment: 'qa' }).success).toBe(false)
  })
})

describe('write-tool input bounds', () => {
  // The public MCP server (apps/mcp-issues) runs create_issue and
  // update_issue_status with no approval gate, and the whole board is one
  // Durable Object value — so an unbounded string here is a way to break the
  // shared demo for everyone with a single well-formed request.
  it('refuses a title far larger than any real issue', () => {
    const huge = 'x'.repeat(300_000)
    const result = WRITE_TOOL_INPUT_SCHEMAS.create_issue.safeParse({
      title: huge,
      type: 'bug',
    })
    expect(result.success).toBe(false)
  })

  it('bounds every free-text field a client controls', () => {
    const tooLong = 'x'.repeat(100_000)

    expect(
      WRITE_TOOL_INPUT_SCHEMAS.create_issue.safeParse({
        title: 'ok',
        type: 'bug',
        description: tooLong,
      }).success,
    ).toBe(false)
    expect(
      WRITE_TOOL_INPUT_SCHEMAS.update_issue_status.safeParse({
        issueKey: 'DS-7',
        status: 'done',
        comment: tooLong,
      }).success,
    ).toBe(false)
    expect(
      WRITE_TOOL_INPUT_SCHEMAS.create_release_notes.safeParse({
        version: 'v1.5.0',
        markdown: tooLong,
      }).success,
    ).toBe(false)
  })

  it('caps the label array in both directions', () => {
    const base = { title: 'ok', type: 'bug' as const }
    // Too many...
    expect(
      WRITE_TOOL_INPUT_SCHEMAS.create_issue.safeParse({
        ...base,
        labels: Array.from({ length: 50 }, (_, i) => `l${i}`),
      }).success,
    ).toBe(false)
    // ...and one that is too long.
    expect(
      WRITE_TOOL_INPUT_SCHEMAS.create_issue.safeParse({
        ...base,
        labels: ['x'.repeat(5_000)],
      }).success,
    ).toBe(false)
  })

  it('reports an oversized labels array once, not once per element', () => {
    // zod 4.4.3 walked every element first, and two million non-strings cost
    // about 2 GB of issues before the array's own limit was reported.
    const result = WRITE_TOOL_INPUT_SCHEMAS.create_issue.safeParse({
      title: 'ok',
      type: 'bug',
      labels: Array.from({ length: 1_000 }, () => 0),
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.code)).toEqual(['too_big'])
  })

  it('still accepts a realistic write', () => {
    const result = WRITE_TOOL_INPUT_SCHEMAS.create_issue.safeParse({
      title: 'Billing export times out for large workspaces',
      description: 'Repro: 10k rows.\nExpected: streams.\n',
      type: 'bug',
      labels: ['billing', 'perf'],
    })
    expect(result.success).toBe(true)
  })
})
