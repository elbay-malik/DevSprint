import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const addToolApprovalResponse = vi.fn()

vi.mock('../composables/useDevSprintChat', () => ({
  useDevSprintChat: () => ({ addToolApprovalResponse }),
}))

const { default: ApprovalCard } = await import('./ApprovalCard.vue')

function requested(input: Record<string, unknown>, toolName = 'update_issue_status') {
  return {
    type: `tool-${toolName}`,
    toolCallId: 'call-1',
    state: 'approval-requested',
    input,
    approval: { id: 'approval-1', signature: 'sig' },
  }
}

function mountCard(part: unknown) {
  return mount(ApprovalCard, { props: { part: part as never } })
}

describe('ApprovalCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    addToolApprovalResponse.mockClear()
  })

  it('says what the write would change, in the reader’s terms', () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))

    // The board is already on screen, so the card can name the move and title
    // rather than making the reader parse JSON.
    expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe('DS-7: In review → Done')
    expect(wrapper.text()).toContain('Billing export CSV download')
    expect(wrapper.text()).toContain('update_issue_status')
  })

  it('keeps the raw arguments one click away', () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))
    expect(wrapper.get('summary').text()).toBe('Raw arguments')
    expect(wrapper.get('pre').text()).toContain('"issueKey": "DS-7"')
  })

  it('summarises the other gated writes too', () => {
    expect(
      mountCard(
        requested(
          { title: 'Add CSV export progress', type: 'feature', sprintId: null },
          'create_issue',
        ),
      )
        .get('[data-testid="approval-headline"]')
        .text(),
    ).toBe('New feature in the backlog')

    expect(
      mountCard(requested({ version: 'v1.5.0', markdown: '# notes' }, 'create_release_notes'))
        .get('[data-testid="approval-headline"]')
        .text(),
    ).toContain('v1.5.0')
  })

  it('answers with the approval id, not the tool call id', async () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))

    await wrapper.get('[data-testid="approval-approve"]').trigger('click')

    expect(addToolApprovalResponse).toHaveBeenCalledWith({ id: 'approval-1', approved: true })
  })

  it('passes the denial reason through', async () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-11', status: 'done' }))

    await wrapper.get('[data-testid="approval-reason"]').setValue('Still blocked on vendor sandbox')
    await wrapper.get('[data-testid="approval-deny"]').trigger('click')

    expect(addToolApprovalResponse).toHaveBeenCalledWith({
      id: 'approval-1',
      approved: false,
      reason: 'Still blocked on vendor sandbox',
    })
  })

  it('omits an empty reason rather than sending blank text', async () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-11', status: 'done' }))

    await wrapper.get('[data-testid="approval-reason"]').setValue('   ')
    await wrapper.get('[data-testid="approval-deny"]').trigger('click')

    expect(addToolApprovalResponse).toHaveBeenCalledWith({ id: 'approval-1', approved: false })
  })

  it('stays in the transcript as the record of what was decided', () => {
    const approved = mountCard({
      ...requested({ issueKey: 'DS-7', status: 'done' }),
      state: 'output-available',
      output: { ok: true, data: {} },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(approved.get('[data-testid="approval-outcome"]').text()).toContain('Approved by you')
    expect(approved.get('[data-testid="approval-outcome"]').text()).toContain('applied')
    expect(approved.find('[data-testid="approval-approve"]').exists()).toBe(false)

    const denied = mountCard({
      ...requested({ issueKey: 'DS-11', status: 'done' }),
      state: 'output-denied',
      approval: { id: 'approval-1', approved: false, reason: 'Still blocked', signature: 'sig' },
    })
    expect(denied.get('[data-testid="approval-outcome"]').text()).toContain('Denied')
    expect(denied.get('[data-testid="approval-outcome"]').text()).toContain('Still blocked')
    expect(denied.find('[data-testid="approval-deny"]').exists()).toBe(false)
  })

  it('styles an applied write as settled, keeping red for real failures', () => {
    // Text alone can say "applied" in the colour of an error; a reader takes
    // the colour first, so four red cards in S-B would read as four failures.
    const applied = mountCard({
      ...requested({ issueKey: 'DS-7', status: 'done' }),
      state: 'output-available',
      output: { ok: true, data: {} },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(applied.get('[data-testid="approval-outcome"]').classes()).not.toContain(
      'text-destructive',
    )

    const failed = mountCard({
      ...requested({ issueKey: 'DS-42', status: 'done' }),
      state: 'output-available',
      output: { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: 'No such issue.' } },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(failed.get('[data-testid="approval-outcome"]').classes()).toContain('text-destructive')
  })

  it('does not rewrite its own record once the board catches up', () => {
    // The store still says DS-7 is in_review while pending, but after the write
    // lands it says done — a live "from" status would read "done → done".
    const resolved = mountCard({
      ...requested({ issueKey: 'DS-7', status: 'done' }),
      state: 'output-available',
      output: { ok: true, data: {} },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(resolved.get('[data-testid="approval-headline"]').text()).toBe('DS-7: Done')
  })

  it('shows a write that errored as failed, not as approved and fine', () => {
    const wrapper = mountCard({
      ...requested({ issueKey: 'DS-7', status: 'done' }),
      state: 'output-error',
      errorText: 'Tool execution timed out',
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(wrapper.get('[data-testid="approval-outcome"]').text()).toContain(
      'Tool execution timed out',
    )
  })

  it('gives the denial reason input an accessible name that starts with its label', () => {
    // The name opens with what the field shows ("Reason (optional)") and says
    // which change it is about, without the raw tool name.
    const wrapper = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))
    const name = wrapper.get('[data-testid="approval-reason"]').attributes('aria-label')
    expect(name).toMatch(/^Reason \(optional\)/)
    expect(name).toContain('DS-7: In review → Done')
  })

  it('names a deployment it gates by version and environment', () => {
    const wrapper = mountCard(
      requested({ environment: 'staging', version: 'v1.5.0-rc.1' }, 'run_deployment'),
    )
    expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe(
      'Deploy v1.5.0-rc.1 to staging',
    )
  })

  it('leads a failed write with what went wrong, and keeps the code as detail', () => {
    const wrapper = mountCard({
      ...requested({ issueKey: 'DS-42', status: 'done' }),
      state: 'output-available',
      output: {
        ok: false,
        error: { code: 'ISSUE_NOT_FOUND', message: "No issue with key 'DS-42'." },
      },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    const outcome = wrapper.get('[data-testid="approval-outcome"]').text()
    expect(outcome).toMatch(/^Approved by you, but it failed: No issue with key 'DS-42'\./)
    expect(wrapper.get('[data-testid="approval-error-code"]').text()).toBe('(ISSUE_NOT_FOUND)')
    // Separated by a space: the template once ran them together as "….(CODE)".
    expect(outcome).toContain("'DS-42'. (ISSUE_NOT_FOUND)")
  })

  it('reports a deployment by its own status, not as applied', () => {
    // run_deployment reaches output-available on its first frame and stays
    // there for the whole run, so a plain ok:true would read "applied" while
    // the deploy was still going — and again after a run the user cancelled.
    const deploying = (status: string) => ({
      ...requested({ environment: 'staging', version: 'v1.5.0' }, 'run_deployment'),
      state: 'output-available',
      output: { ok: true, data: { deployment: { id: 'dep-9', status, stages: [] } } },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })

    const running = mountCard(deploying('running'))
    expect(running.get('[data-testid="approval-outcome"]').text()).toContain('running')
    expect(running.get('[data-testid="approval-outcome"]').text()).not.toContain('applied')

    const cancelled = mountCard(deploying('cancelled'))
    const outcome = cancelled.get('[data-testid="approval-outcome"]')
    expect(outcome.text()).toContain('cancelled')
    // The user asked for it, so it is not styled as something that went wrong.
    expect(outcome.text()).not.toMatch(/failed/i)
  })

  it('says why a write failed, not just which code it failed with', () => {
    // Every envelope carries a message written to be read; showing only the
    // code made the one card that reports a failed write the least
    // informative thing on screen.
    const wrapper = mountCard({
      ...requested({ issueKey: 'DS-42', status: 'done' }),
      state: 'output-available',
      output: {
        ok: false,
        error: {
          code: 'ISSUE_NOT_FOUND',
          message:
            "No issue with key 'DS-42'. Search by title to find the issue you meant (search_issues).",
        },
      },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })

    const outcome = wrapper.get('[data-testid="approval-outcome"]').text()
    expect(outcome).toContain('ISSUE_NOT_FOUND')
    expect(outcome).toContain('Search by title to find the issue you meant')
  })

  it('surfaces a failed write rather than implying it worked', () => {
    const wrapper = mountCard({
      ...requested({ issueKey: 'DS-42', status: 'done' }),
      state: 'output-available',
      output: { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: 'no' } },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(wrapper.get('[data-testid="approval-outcome"]').text()).toContain('ISSUE_NOT_FOUND')
  })

  it('records an approval as soon as it is given', () => {
    const wrapper = mountCard({
      ...requested({ issueKey: 'DS-7', status: 'done' }),
      state: 'approval-responded',
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(wrapper.get('[data-testid="approval-outcome"]').text()).toBe('Approved by you.')
  })

  it('offers its decision as a named group the transcript can move focus to', () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))
    const group = wrapper.get('[data-approval-focus]')
    expect(group.attributes('role')).toBe('group')
    expect(group.attributes('aria-label')).toBe('Decision: DS-7: In review → Done')
    // Reachable by script only; Tab goes straight to the reason field.
    expect(group.attributes('tabindex')).toBe('-1')
  })

  it('keeps the reason field at 16px below md, so iOS does not zoom into it', () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))
    const classes = wrapper.get('[data-testid="approval-reason"]').classes()
    expect(classes).toContain('text-base')
    expect(classes).toContain('md:text-xs')
    expect(classes).not.toContain('text-xs')
  })
})
