import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import ToolResultCard from './ToolResultCard.vue'

function part(type: string, output: unknown, state = 'output-available', input = {}) {
  return { type, toolCallId: 'c1', state, input, output }
}

function mountCard(value: unknown) {
  return mount(ToolResultCard, { props: { part: value as never } })
}

const BURNDOWN = {
  sprintId: 'sprint-12',
  unit: 'points',
  committedPoints: 31,
  asOf: '2026-07-01T09:00:00Z',
  days: [
    { date: '2026-06-22', remaining: 31, ideal: 31 },
    { date: '2026-07-05', remaining: 23, ideal: 0 },
  ],
}

describe('ToolResultCard', () => {
  // The burndown names its sprint from the workspace store.
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('gives each tool the card the registry assigns it', () => {
    const cards: [string, unknown, string][] = [
      ['tool-list_issues', { ok: true, data: { issues: [] } }, 'issue-table'],
      ['tool-search_issues', { ok: true, data: { matches: [] } }, 'issue-table'],
      ['tool-get_burndown', { ok: true, data: BURNDOWN }, 'burndown-chart'],
      [
        'tool-diff_release_notes',
        { ok: true, data: { baseVersion: 'v1.4.2', before: 'a', after: 'b', changedSections: [] } },
        'release-notes-diff',
      ],
    ]

    for (const [type, output, testid] of cards) {
      const wrapper = mountCard(part(type, output))
      expect(wrapper.find(`[data-testid="${testid}"]`).exists()).toBe(true)
    }
  })

  it('keeps the chip for the tools the registry says keep it', () => {
    for (const tool of ['tool-get_sprint_status', 'tool-get_deployment_history']) {
      const wrapper = mountCard(part(tool, { ok: true, data: {} }))
      expect(wrapper.find('[data-testid="tool-call-chip"]').exists()).toBe(true)
    }
  })

  it('shows a failed call as an error, whatever tool it came from', () => {
    const wrapper = mountCard(
      part(
        'tool-list_issues',
        {
          ok: false,
          error: { code: 'SPRINT_NOT_FOUND', message: "No sprint with id 'sprint-99'." },
        },
        'output-available',
        { sprintId: 'sprint-99' },
      ),
    )

    // The error wins over the tool's own card: an empty table would say the
    // sprint exists and has no issues, which is a different claim.
    expect(wrapper.find('[data-testid="issue-table"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="error-code"]').text()).toBe('SPRINT_NOT_FOUND')
    // Named from the call's own arguments, in the board's words.
    expect(wrapper.get('[data-testid="error-message"]').text()).toBe(
      'No sprint with the id sprint-99.',
    )
  })

  it('falls back to the chip until the call has a result', () => {
    const wrapper = mountCard(part('tool-get_burndown', undefined, 'input-available'))
    expect(wrapper.find('[data-testid="tool-call-chip"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="burndown-chart"]').exists()).toBe(false)
  })

  it('falls back to the chip when the payload is not our envelope', () => {
    const wrapper = mountCard(part('tool-get_burndown', { unexpected: true }))
    expect(wrapper.find('[data-testid="tool-call-chip"]').exists()).toBe(true)
  })
})
