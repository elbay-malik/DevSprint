import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BurndownData } from '@devsprint/shared/tools'
import BurndownChart from './BurndownChart.vue'

/** The seeded sprint: 31 committed, behind the ideal line at the demo clock. */
function burndown(overrides: Partial<BurndownData> = {}): BurndownData {
  return {
    sprintId: 'sprint-12',
    unit: 'points',
    committedPoints: 31,
    asOf: '2026-07-01T09:00:00Z',
    days: [
      { date: '2026-06-29', remaining: 23, ideal: 12.4 },
      { date: '2026-07-01', remaining: 23, ideal: 6.2 },
      { date: '2026-07-05', remaining: 23, ideal: 0 },
    ],
    ...overrides,
  }
}

describe('BurndownChart', () => {
  it('reads the sprint at the demo clock, not at the last day', () => {
    // The sprint runs past `asOf`, so the last bucket is a projection. Leading
    // with it would claim the sprint had already ended.
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })

    expect(wrapper.text()).toContain('07/01')
    expect(wrapper.text()).toContain('23 of 31 points left')
    expect(wrapper.text()).toContain('ideal 6.2')
  })

  it('names both series so identity never rests on colour', () => {
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })
    expect(wrapper.text()).toContain('Remaining')
    expect(wrapper.text()).toContain('Ideal')
  })

  it('draws a line per series', () => {
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })
    const paths = wrapper.findAll('path')
    expect(paths).toHaveLength(2)
    // The reference line is dashed, which is the non-colour encoding.
    expect(paths.some((path) => path.attributes('stroke-dasharray') !== undefined)).toBe(true)
    expect(paths.some((path) => path.attributes('stroke-dasharray') === undefined)).toBe(true)
  })

  it('offers the numbers as a table, not only as a picture', () => {
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('2026-06-29')
  })

  it('describes itself for a screen reader', () => {
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toContain('23 of 31')
  })

  it('survives a sprint whose days are all zero', () => {
    // A degenerate series must not divide by zero and blow up the transcript.
    const wrapper = mount(BurndownChart, {
      props: {
        data: burndown({
          committedPoints: 0,
          days: [{ date: '2026-07-01', remaining: 0, ideal: 0 }],
        }),
      },
    })
    expect(wrapper.find('[data-testid="burndown-chart"]').exists()).toBe(true)
    expect(wrapper.html()).not.toContain('NaN')
  })
})
