import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ReleaseNotesDiffData } from '@devsprint/shared/tools'
import ReleaseNotesDiff from './ReleaseNotesDiff.vue'

function diff(overrides: Partial<ReleaseNotesDiffData> = {}): ReleaseNotesDiffData {
  return {
    baseVersion: 'v1.4.2',
    before: '## v1.4.2\n\n### Fixed\n\n- OAuth refresh loop (DS-1)',
    after: '## v1.5.0\n\n### Added\n\n- Digest email template (DS-5)',
    changedSections: [
      { heading: 'Fixed', changeType: 'removed' },
      { heading: 'Added', changeType: 'modified' },
    ],
    ...overrides,
  }
}

describe('ReleaseNotesDiff', () => {
  it('opens on the draft, since that is what is up for review', () => {
    const wrapper = mount(ReleaseNotesDiff, { props: { data: diff() } })
    expect(wrapper.get('[data-testid="diff-pane"]').text()).toContain('v1.5.0')
    expect(wrapper.get('[data-testid="diff-after"]').attributes('aria-pressed')).toBe('true')
  })

  it('switches to the published version', async () => {
    const wrapper = mount(ReleaseNotesDiff, { props: { data: diff() } })

    await wrapper.get('[data-testid="diff-before"]').trigger('click')

    expect(wrapper.get('[data-testid="diff-pane"]').text()).toContain('OAuth refresh loop')
    expect(wrapper.get('[data-testid="diff-before"]').attributes('aria-pressed')).toBe('true')
  })

  it('names each change in words, not only by colour', () => {
    const wrapper = mount(ReleaseNotesDiff, { props: { data: diff() } })
    expect(wrapper.text()).toContain('removed')
    expect(wrapper.text()).toContain('Fixed')
    expect(wrapper.text()).toContain('modified')
    expect(wrapper.text()).toContain('Added')
  })

  it('says so when nothing changed', () => {
    const wrapper = mount(ReleaseNotesDiff, { props: { data: diff({ changedSections: [] }) } })
    expect(wrapper.text()).toContain('matches v1.4.2 section for section')
  })

  it('marks the pressed half with more than a fill, keyed to aria-pressed', async () => {
    // The Paper Tint fill is about 1.1:1 on Paper, so the underline carries it.
    const wrapper = mount(ReleaseNotesDiff, { props: { data: diff() } })
    const before = wrapper.get('[data-testid="diff-before"]')
    const after = wrapper.get('[data-testid="diff-after"]')
    for (const button of [before, after]) {
      expect(button.classes()).toContain('aria-pressed:underline')
    }

    await before.trigger('click')

    expect(before.attributes('aria-pressed')).toBe('true')
    expect(after.attributes('aria-pressed')).toBe('false')
  })
})
