import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { DynamicToolUIPart, ToolUIPart } from 'ai'
import type { DevSprintUITools } from '@devsprint/shared/tools'
import ToolCallChip from './ToolCallChip.vue'

type ChipPart = ToolUIPart<DevSprintUITools> | DynamicToolUIPart

function mountChip(part: ChipPart) {
  return mount(ToolCallChip, { props: { part } })
}

describe('ToolCallChip', () => {
  it('renders the tool name, "ok" and the Result disclosure for a successful call', () => {
    const wrapper = mountChip({
      type: 'tool-search_issues',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'billing export', limit: 10 },
      output: {
        ok: true,
        data: {
          matches: [
            { key: 'DS-7', title: 'Billing export CSV download', status: 'in_review', score: 0.83 },
          ],
        },
      },
    })

    const chip = wrapper.get('[data-testid="tool-call-chip"]')
    expect(chip.attributes('data-state')).toBe('output-available')
    expect(chip.text()).toContain('search_issues')
    expect(wrapper.get('[data-testid="tool-call-state"]').text()).toBe('ok')

    const summaries = wrapper.findAll('summary').map((s) => s.text())
    expect(summaries).toEqual(['Arguments', 'Result'])
    const [args, result] = wrapper.findAll('pre').map((pre) => pre.text())
    expect(args).toContain('"query": "billing export"')
    expect(result).toContain('"key": "DS-7"')
  })

  it('renders the error code for an ok:false envelope', () => {
    // A dynamic part stands in for a Phase 5 write tool the SPA has no static type for.
    const wrapper = mountChip({
      type: 'dynamic-tool',
      toolName: 'update_issue_status',
      toolCallId: 'call-2',
      state: 'output-available',
      input: { issueKey: 'DS-42', status: 'done' },
      output: { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: 'No issue DS-42' } },
    })

    expect(wrapper.text()).toContain('update_issue_status')
    expect(wrapper.get('[data-testid="tool-call-state"]').text()).toBe('ISSUE_NOT_FOUND')
    expect(wrapper.findAll('summary')).toHaveLength(2)
  })

  it('shows a running state without a Result disclosure while input is available', () => {
    const wrapper = mountChip({
      type: 'tool-get_sprint_status',
      toolCallId: 'call-3',
      state: 'input-available',
      input: { sprintId: 'sprint-12' },
    })

    expect(wrapper.get('[data-testid="tool-call-chip"]').attributes('data-state')).toBe(
      'input-available',
    )
    expect(wrapper.get('[data-testid="tool-call-state"]').text()).toBe('running…')
    expect(wrapper.findAll('summary').map((s) => s.text())).toEqual(['Arguments'])
  })

  it('shows "failed" with the error text for output-error', () => {
    const wrapper = mountChip({
      type: 'tool-get_burndown',
      toolCallId: 'call-4',
      state: 'output-error',
      input: { sprintId: 'sprint-99' },
      errorText: 'Tool execution timed out',
    })

    expect(wrapper.get('[data-testid="tool-call-state"]').text()).toBe('failed')
    expect(wrapper.text()).toContain('Tool execution timed out')
    expect(wrapper.findAll('summary')).toHaveLength(1)
  })

  it('labels approval states as awaiting approval', () => {
    const wrapper = mountChip({
      type: 'dynamic-tool',
      toolName: 'create_issue',
      toolCallId: 'call-5',
      state: 'approval-requested',
      input: { title: 'New issue', type: 'bug' },
      approval: { id: 'approval-1' },
    })

    expect(wrapper.get('[data-testid="tool-call-state"]').text()).toBe('awaiting approval')
  })
})
