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

  it('draws a plain board when nothing is pending or changed', () => {
    const wrapper = mountBoard()
    expect(wrapper.find('[data-pending-move]').exists()).toBe(false)
    expect(wrapper.find('[data-board-change]').exists()).toBe(false)
  })
})
