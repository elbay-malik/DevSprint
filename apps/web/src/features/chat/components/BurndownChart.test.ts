import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
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

/**
 * A ResizeObserver the test drives: `resize(width)` reports the chart as drawn
 * at that many CSS pixels, as the browser would once layout has run.
 */
function fakeResizeObserver() {
  const callbacks: ResizeObserverCallback[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  return {
    async resize(width: number) {
      const entry = { contentRect: { width } } as ResizeObserverEntry
      for (const callback of callbacks) callback([entry], {} as ResizeObserver)
      await nextTick()
    },
  }
}

describe('BurndownChart', () => {
  // The title names the sprint from the workspace store's seed.
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** The y of each point on a path, in SVG units (larger is lower on screen). */
  function ys(d: string | undefined): number[] {
    return [...(d ?? '').matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((match) => Number(match[1]))
  }

  it('draws each series from its own values, the right way up', () => {
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })
    const ideal = wrapper.get('path[stroke-dasharray]').attributes('d')
    const remaining = wrapper.get('path:not([stroke-dasharray])').attributes('d')

    // Two lines from two series, not one series drawn twice.
    expect(ideal).not.toBe(remaining)
    // Ideal burns 12.4 → 0, so it falls down the chart (y grows).
    const idealYs = ys(ideal)
    expect(idealYs).toHaveLength(3)
    expect(idealYs[0]).toBeLessThan(idealYs[2] ?? 0)
    // Behind the line means more left than ideal, which is drawn *above* it —
    // the picture has to agree with the narration's "behind" (S-D).
    expect(ys(remaining)[2]).toBeLessThan(idealYs[2] ?? 0)
  })

  it('reads the sprint at the demo clock, not at the last day', () => {
    // The sprint runs past `asOf`, so the last bucket is a projection. Leading
    // with it would claim the sprint had already ended.
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })

    expect(wrapper.text()).toContain('07/01')
    expect(wrapper.text()).toContain('23 of 31 points left')
    expect(wrapper.text()).toContain('ideal 6')
    expect(wrapper.text()).not.toContain('6.2')
  })

  it('is titled with the sprint’s name, not its id', () => {
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })
    const title = wrapper.get('[data-testid="burndown-title"]')
    expect(title.text()).toBe('Burndown: Sprint 12 — Notifications & billing')
    expect(title.find('.font-mono').exists()).toBe(false)
    expect(wrapper.get('svg[role="img"]').attributes('aria-label')).toMatch(
      /^Burndown for Sprint 12 — Notifications & billing:/,
    )
  })

  it('falls back to the id, in mono, for a sprint the board does not hold', () => {
    const wrapper = mount(BurndownChart, { props: { data: burndown({ sprintId: 'sprint-99' }) } })
    const title = wrapper.get('[data-testid="burndown-title"]')
    expect(title.text()).toBe('Burndown: sprint-99')
    expect(title.get('.font-mono').text()).toBe('sprint-99')
  })

  it('gives the ideal in whole points in the labels and the table, but draws it exactly', () => {
    const wrapper = mount(BurndownChart, {
      props: {
        data: burndown({
          days: [
            { date: '2026-06-29', remaining: 23, ideal: 9.54 },
            { date: '2026-07-01', remaining: 23, ideal: 6.2 },
            { date: '2026-07-05', remaining: 23, ideal: 2.5 },
          ],
        }),
      },
    })
    const idealCells = wrapper.findAll('tbody tr').map((row) => row.findAll('td')[2]?.text())
    expect(idealCells).toEqual(['10', '6', '3'])
    // The end label, in the table's figures.
    const endLabels = wrapper.findAll('svg[role="img"] text.fill-muted-foreground')
    expect(endLabels.at(-1)?.text()).toBe('3')
    expect(wrapper.text()).not.toMatch(/9\.54|6\.2|2\.5/)
    // The line is not rounded: 2.5 and 3 would be different heights.
    const idealYs = ys(wrapper.get('path[stroke-dasharray]').attributes('d'))
    expect(idealYs.at(-1)).toBeCloseTo(14 + 142 - (2.5 / 31) * 142, 5)
  })

  it('labels dates between the first and the last, so the axis can be read', async () => {
    const observer = fakeResizeObserver()
    // Sprint 12: 06/22 to 07/05.
    const fortnight = Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 5, 22 + index)).toISOString().slice(0, 10),
      remaining: 31,
      ideal: 31 - index * 2,
    }))
    const wrapper = mount(BurndownChart, { props: { data: burndown({ days: fortnight }) } })
    await observer.resize(344)

    const dates = wrapper.findAll('[data-testid="burndown-date"]').map((label) => label.text())
    expect(dates[0]).toBe('06/22')
    expect(dates.length).toBeGreaterThan(2)
    expect(dates.at(-1)).toBe('07/05')
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

  it('labels the value axis in round steps from zero', async () => {
    // Thirds of 31 read 0 / 10 / 21 / 31, steps nobody can count in.
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })
    const labels = () =>
      wrapper.findAll('svg[role="img"] text[text-anchor="end"]').map((label) => label.text())
    expect(labels()).toEqual(['0', '10', '20', '30'])
    expect(wrapper.findAll('g.text-border line')).toHaveLength(4)

    // A one-point sprint gets its two lines, not four labelled 0, 0, 1, 1.
    await wrapper.setProps({
      data: burndown({
        committedPoints: 1,
        days: [
          { date: '2026-07-01', remaining: 1, ideal: 1 },
          { date: '2026-07-05', remaining: 0, ideal: 0 },
        ],
      }),
    })
    expect(labels()).toEqual(['0', '1'])
    expect(wrapper.findAll('g.text-border line')).toHaveLength(2)
  })

  it('draws in CSS pixels, so its labels are not scaled down in a narrow column', async () => {
    // A fixed 440-wide viewBox in a ~344px column drew 10px labels at under 8px.
    const observer = fakeResizeObserver()
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })
    const chart = () => wrapper.get('svg[role="img"]')
    expect(chart().attributes('viewBox')).toBe('0 0 440 180')

    await observer.resize(310)

    expect(chart().attributes('viewBox')).toBe('0 0 310 180')
    // The plot follows: its right edge sits the right padding in from 310.
    const xs = [...(chart().get('path').attributes('d') ?? '').matchAll(/[ML]([\d.]+) /g)]
    expect(Number(xs.at(-1)?.[1])).toBe(310 - 42)
  })

  it('keeps its last width while it is collapsed', async () => {
    const observer = fakeResizeObserver()
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })

    await observer.resize(344)
    await observer.resize(0)

    expect(wrapper.get('svg[role="img"]').attributes('viewBox')).toBe('0 0 344 180')
  })

  it('sets every axis and end label at 11px', () => {
    const wrapper = mount(BurndownChart, { props: { data: burndown() } })
    const labels = wrapper.findAll('svg[role="img"] text')
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      const sized = label.element.closest('[class*="text-[11px]"]')
      expect(sized, label.text()).not.toBeNull()
    }
  })
})
