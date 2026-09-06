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
