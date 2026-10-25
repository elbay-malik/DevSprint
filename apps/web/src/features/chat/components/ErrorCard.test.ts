import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ToolError } from '@devsprint/shared'
import ErrorCard from './ErrorCard.vue'

describe('ErrorCard', () => {
  const props: { toolName: string; error: ToolError } = {
    toolName: 'update_issue_status',
    error: { code: 'ISSUE_NOT_FOUND', message: 'No issue DS-42 on this board.' },
  }

  it('leads with the message and keeps the code as a visible label', () => {
    const wrapper = mount(ErrorCard, { props })
    expect(wrapper.get('[data-testid="error-message"]').text()).toBe(props.error.message)
    expect(wrapper.get('[data-testid="error-code"]').text()).toBe('ISSUE_NOT_FOUND')
    expect(wrapper.text()).toContain('update_issue_status')
  })

  it('sits on Paper, where its small code and tool name hold 4.5:1', () => {
    // A Paper Tint fill inside the Paper Tint bubble left Stop Red at 4.37:1 and
    // Graphite at 4.34:1; on Paper they are 4.76:1 and 4.73:1.
    const card = mount(ErrorCard, { props }).get('[data-testid="error-card"]')
    expect(card.classes()).toContain('bg-background')
    expect(card.classes().some((name) => name.startsWith('bg-muted'))).toBe(false)
  })
})
