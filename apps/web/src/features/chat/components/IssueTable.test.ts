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

  it('shows the score instead of points for a search (S-E)', () => {
    const wrapper = mount(IssueTable, { props: { matches: MATCHES } })

    expect(wrapper.find('thead').text()).toContain('Score')
    expect(wrapper.find('thead').text()).not.toContain('Pts')
    expect(wrapper.text()).toContain('0.56')
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
