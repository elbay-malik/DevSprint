import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ToolError } from '@devsprint/shared'
import ErrorCard from './ErrorCard.vue'

describe('ErrorCard', () => {
  const props: { toolName: string; error: ToolError; input: unknown } = {
    toolName: 'update_issue_status',
    error: {
      code: 'ISSUE_NOT_FOUND',
      message:
        "No issue with key 'DS-42'. Search by title to find the issue you meant (search_issues).",
    },
    input: { issueKey: 'DS-42', status: 'done' },
  }

  it('leads with what happened in the board’s words, and keeps the code as a visible label', () => {
    const wrapper = mount(ErrorCard, { props })
    expect(wrapper.get('[data-testid="error-message"]').text()).toBe('No issue DS-42 on the board.')
    expect(wrapper.get('[data-testid="error-code"]').text()).toBe('ISSUE_NOT_FOUND')
    expect(wrapper.text()).toContain('update_issue_status')
  })

  it('never shows the api’s model-facing message', () => {
    // That text tells the model which tool to call next; to a person in the
    // chat it is a debug console.
    const wrapper = mount(ErrorCard, { props })
    expect(wrapper.text()).not.toContain('search_issues')
    expect(wrapper.text()).not.toContain('Search by title')
  })

  it('sits on Paper, where its small code and tool name hold 4.5:1', () => {
    // A Paper Tint fill inside the Paper Tint bubble left Stop Red at 4.37:1 and
    // Graphite at 4.34:1; on Paper they are 4.76:1 and 4.73:1.
    const card = mount(ErrorCard, { props }).get('[data-testid="error-card"]')
    expect(card.classes()).toContain('bg-background')
    expect(card.classes().some((name) => name.startsWith('bg-muted'))).toBe(false)
  })
})
