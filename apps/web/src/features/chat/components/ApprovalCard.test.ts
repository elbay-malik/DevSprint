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
    expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe('DS-7: in_review → done')
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

  it('does not rewrite its own record once the board catches up', () => {
    // The store still says DS-7 is in_review while pending, but after the write
    // lands it says done — a live "from" status would read "done → done".
    const resolved = mountCard({
      ...requested({ issueKey: 'DS-7', status: 'done' }),
      state: 'output-available',
      output: { ok: true, data: {} },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(resolved.get('[data-testid="approval-headline"]').text()).toBe('DS-7: done')
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

  it('gives the denial reason input an accessible name', () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))
    expect(wrapper.get('[data-testid="approval-reason"]').attributes('aria-label')).toContain(
      'Reason for denying',
    )
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
          message: "No issue with key 'DS-42'. Use search_issues to find the issue you meant.",
        },
      },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })

    const outcome = wrapper.get('[data-testid="approval-outcome"]').text()
    expect(outcome).toContain('ISSUE_NOT_FOUND')
    expect(outcome).toContain('search_issues to find the issue you meant')
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
})
