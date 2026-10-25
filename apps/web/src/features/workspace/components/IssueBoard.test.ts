import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import IssueBoard from './IssueBoard.vue'

const seed = createWorkspaceSeed()
const sprint = seed.sprints.find((candidate) => candidate.state === 'active')
const issues = seed.issues.filter((issue) => issue.sprintId === sprint?.id)
const backlog = seed.issues.filter((issue) => issue.sprintId === null)

function mountBoard(props: { pendingMoves?: Map<string, unknown>; changed?: Set<string> } = {}) {
  return mount(IssueBoard, { props: { issues, backlog, users: seed.users, ...props } })
}

const card = (wrapper: ReturnType<typeof mountBoard>, key: string) =>
  wrapper.get(`[data-testid="issue-card"][data-issue-key="${key}"]`)

describe('IssueBoard', () => {
  it('marks an issue a pending approval would move, naming where it would go', () => {
    const wrapper = mountBoard({ pendingMoves: new Map([['DS-7', 'done']]) })

    const marked = card(wrapper, 'DS-7')
    expect(marked.attributes()).toHaveProperty('data-pending-move')
    expect(marked.classes()).toEqual(
      expect.arrayContaining(['outline-dashed', 'outline-ring', 'outline-1']),
    )
    // Inside the card's own edge, in place of its hairline: stacked pending
    // cards never merge, and none overhangs the column.
    expect(marked.classes()).toEqual(expect.arrayContaining(['-outline-offset-1', 'ring-0']))
    expect(marked.classes()).not.toContain('ring-1')
    expect(marked.classes()).not.toContain('outline-offset-2')
    expect(marked.classes()).not.toContain('outline-2')
    // The destination is a word, so the mark reads without the ring.
    const caption = marked.get('[data-testid="issue-pending-move"]')
    expect(caption.text()).toContain('→')
    expect(caption.text()).toContain('Done')
    expect(caption.get('.sr-only').text()).toBe('Awaiting approval to move to')

    const untouched = card(wrapper, 'DS-9')
    expect(untouched.attributes()).not.toHaveProperty('data-pending-move')
    expect(untouched.find('[data-testid="issue-pending-move"]').exists()).toBe(false)
  })

  it('marks a pending move on a backlog card too, beside its own status', () => {
    const wrapper = mountBoard({ pendingMoves: new Map([['DS-12', 'in_progress']]) })

    const marked = card(wrapper, 'DS-12')
    expect(marked.get('[data-testid="issue-status"]').text()).toBe('Todo')
    expect(marked.get('[data-testid="issue-pending-move"]').text()).toContain('In progress')
  })

  it('flags the cards the last read moved, and only those', () => {
    const wrapper = mountBoard({ changed: new Set(['DS-8']) })

    expect(card(wrapper, 'DS-8').attributes()).toHaveProperty('data-board-change')
    expect(card(wrapper, 'DS-7').attributes()).not.toHaveProperty('data-board-change')
  })

  it('gives counts and points their units for screen readers', () => {
    const wrapper = mountBoard()
    // "2 DS-9 5" was all a screen reader had to go on.
    const done = wrapper.get('[data-testid="board-column-done"]')
    expect(done.get('h2').text()).toBe('Done 2 issues')
    expect(done.get('h2 .sr-only').text()).toBe('issues')
    const blocked = wrapper.get('[data-testid="board-column-blocked"]')
    expect(blocked.get('h2 .sr-only').text()).toBe('issue')

    const points = card(wrapper, 'DS-9').get('[data-slot="badge"]')
    expect(points.text()).toBe('5 points')
    expect(points.get('.sr-only').text()).toBe('points')
  })

  it("lists each column's cards, and the backlog's", () => {
    const wrapper = mountBoard()
    const inReview = wrapper.get('[data-testid="board-column-in_review"]')
    const list = inReview.get('ul')
    expect(list.attributes('role')).toBe('list')
    expect(list.findAll(':scope > li')).toHaveLength(2)
    expect(list.findAll('li [data-testid="issue-card"]')).toHaveLength(2)

    const backlogList = wrapper.get('[data-testid="board-backlog"] ul')
    expect(backlogList.findAll(':scope > li')).toHaveLength(backlog.length)
  })

  it('draws an empty column as a compact slot, not a list', () => {
    const wrapper = mountBoard()
    const todo = wrapper.get('[data-testid="board-column-todo"]')
    expect(todo.find('ul').exists()).toBe(false)
    const slot = todo.get('[data-testid="board-column-empty"]')
    expect(slot.text()).toBe('No issues')
    expect(slot.classes()).toEqual(expect.arrayContaining(['border', 'rounded-xl', 'text-xs']))
  })

  it('lets the backlog heading take focus from the jump above the board', () => {
    const wrapper = mountBoard()
    const heading = wrapper.get('#board-backlog-heading')
    expect(heading.attributes('tabindex')).toBe('-1')
    expect(heading.text()).toContain('Backlog')
  })

  it('draws a plain board when nothing is pending or changed', () => {
    const wrapper = mountBoard()
    expect(wrapper.find('[data-pending-move]').exists()).toBe(false)
    expect(wrapper.find('[data-board-change]').exists()).toBe(false)
  })
})
