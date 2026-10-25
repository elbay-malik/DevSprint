import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { IssueSummary, SearchIssuesMatch } from '@devsprint/shared/tools'
import IssueTable from './IssueTable.vue'

const ISSUES: IssueSummary[] = [
  {
    key: 'DS-7',
    title: 'Billing export CSV download',
    status: 'in_review',
    priority: 'high',
    points: 5,
    assigneeId: 'u-ben',
    sprintId: 'sprint-12',
    labels: ['billing'],
  },
]

const MATCHES: SearchIssuesMatch[] = [
  { key: 'DS-7', title: 'Billing export CSV download', status: 'in_review', score: 0.56 },
]

describe('IssueTable', () => {
  it('lists issues with their points', () => {
    const wrapper = mount(IssueTable, { props: { issues: ISSUES } })

    expect(wrapper.text()).toContain('DS-7')
    expect(wrapper.text()).toContain('Billing export CSV download')
    // The status is spelled out rather than left as the wire value.
    expect(wrapper.text()).toContain('In review')
    expect(wrapper.find('thead').text()).toContain('Pts')
  })

  it('shows how well each issue matched instead of points for a search (S-E)', () => {
    const wrapper = mount(IssueTable, { props: { matches: MATCHES } })

    expect(wrapper.find('thead').text()).toContain('Match')
    expect(wrapper.find('thead').text()).not.toContain('Score')
    expect(wrapper.find('thead').text()).not.toContain('Pts')
    // A word to read, with the raw score kept on hover and for screen readers.
    const cell = wrapper.get('tbody tr td:last-child')
    expect(cell.text()).toMatch(/^Strong/)
    expect(cell.attributes('title')).toBe('Match score 0.56')
    expect(cell.get('.sr-only').text()).toBe(', score 0.56')
    // The title is how a reader recognises the issue they meant (S-E step 4).
    for (const match of MATCHES) expect(wrapper.text()).toContain(match.title)
  })

  it('grades each match on the search tool’s own scale', () => {
    const wrapper = mount(IssueTable, {
      props: {
        matches: [
          { ...MATCHES[0]!, score: 1 },
          { ...MATCHES[0]!, key: 'DS-8', score: 0.33 },
          { ...MATCHES[0]!, key: 'DS-9', score: 0.11 },
        ],
      },
    })
    const words = wrapper
      .findAll('tbody td:last-child')
      .map((cell) => cell.text().replace(/,.*$/, ''))
    expect(words).toEqual(['Strong', 'Good', 'Weak'])
  })

  it('keeps points plain in the full table', () => {
    const cell = mount(IssueTable, { props: { issues: ISSUES } }).get('tbody td:last-child')
    expect(cell.text()).toBe('5')
    expect(cell.attributes('title')).toBeUndefined()
  })

  it('counts what it is showing', () => {
    expect(mount(IssueTable, { props: { issues: ISSUES } }).text()).toContain('1 issue')
    expect(
      mount(IssueTable, { props: { issues: [...ISSUES, { ...ISSUES[0]!, key: 'DS-8' }] } }).text(),
    ).toContain('2 issues')
  })

  it('says nothing matched rather than showing an empty frame', () => {
    // An empty search is a successful call, so it needs an answer, not a blank.
    expect(mount(IssueTable, { props: { matches: [] } }).text()).toContain('No matching issues')
    expect(mount(IssueTable, { props: { issues: [] } }).text()).toContain('No issues match')
  })
})
