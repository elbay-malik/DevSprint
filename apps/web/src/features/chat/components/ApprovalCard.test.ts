import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace'

const addToolApprovalResponse = vi.fn()

vi.mock('../composables/useDevSprintChat', () => ({
  useDevSprintChat: () => ({ addToolApprovalResponse }),
}))

const { default: ApprovalCard } = await import('./ApprovalCard.vue')
const { clearApprovalRecords } = await import('../lib/approval-records')

function requested(input: Record<string, unknown>, toolName = 'update_issue_status') {
  return {
    type: `tool-${toolName}`,
    toolCallId: 'call-1',
    state: 'approval-requested',
    input,
    approval: { id: 'approval-1', signature: 'sig' },
  }
}

function mountCard(part: unknown, props: { lead?: boolean } = {}) {
  return mount(ApprovalCard, { props: { part: part as never, ...props } })
}

/** Ink fill: the default button variant's background class. */
const isInk = (wrapper: ReturnType<typeof mountCard>, testid: string) =>
  wrapper.get(`[data-testid="${testid}"]`).classes().includes('bg-primary')

describe('ApprovalCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    addToolApprovalResponse.mockClear()
    clearApprovalRecords()
    vi.useRealTimers()
  })

  /**
   * Answers a pending card the way the transcript sees it: the card records the
   * decision, then the SDK's next state remounts it (the list keys parts by state).
   */
  async function decide(
    input: Record<string, unknown>,
    approved: boolean,
    next: Record<string, unknown>,
    toolName?: string,
  ) {
    const pending = mountCard(requested(input, toolName))
    await pending.get(`[data-testid="approval-${approved ? 'approve' : 'deny'}"]`).trigger('click')
    pending.unmount()
    return mountCard({
      ...requested(input, toolName),
      approval: { id: 'approval-1', approved, signature: 'sig' },
      ...next,
    })
  }

  it('says what the write would change, in the reader’s terms', () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))

    // The board is already on screen, so the card can name the move and title
    // rather than making the reader parse JSON.
    expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe('DS-7: In review → Done')
    expect(wrapper.text()).toContain('Billing export CSV download')
    expect(wrapper.text()).toContain('update_issue_status')
  })

  it('puts no label above the headline, and the tool in a quiet line below it', () => {
    // "Approval required:" over a decided card was untrue, and an eyebrow over
    // a heading is off-system either way.
    const wrapper = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))
    expect(wrapper.text()).not.toContain('Approval required')

    const headline = wrapper.get('[data-testid="approval-headline"]').element
    const tool = wrapper.get('[data-testid="approval-tool"]')
    expect(tool.text()).toBe('update_issue_status')
    expect(tool.classes()).toEqual(expect.arrayContaining(['font-mono', 'text-muted-foreground']))
    expect(headline.compareDocumentPosition(tool.element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('keeps the from-status after the decision, so the record reads as the change', async () => {
    const resolved = await decide({ issueKey: 'DS-9', status: 'done' }, true, {
      state: 'output-available',
      output: { ok: true, data: {} },
    })
    expect(resolved.get('[data-testid="approval-headline"]').text()).toBe(
      'DS-9: In progress → Done',
    )

    // The board catching up the write must not change it: it is the record.
    const board = useWorkspaceStore()
    board.workspace.issues.find((issue) => issue.key === 'DS-9')!.status = 'done'
    await resolved.vm.$nextTick()
    expect(resolved.get('[data-testid="approval-headline"]').text()).toBe(
      'DS-9: In progress → Done',
    )
  })

  it('records when the decision was made, on a 24-hour clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 25, 14, 2))

    const applied = await decide({ issueKey: 'DS-7', status: 'done' }, true, {
      state: 'output-available',
      output: { ok: true, data: {} },
    })
    const outcome = applied.get('[data-testid="approval-outcome"]')
    expect(outcome.text()).toBe('● Approved by you at 14:02 — applied.')
    // The glyph is drawn, not read, and only the applied mark takes a hue.
    const mark = applied.get('[data-testid="approval-outcome-mark"]')
    expect(mark.attributes('aria-hidden')).toBe('true')
    expect(mark.classes()).toContain('text-success')
    // One glyph set at one size: Geist has none of them.
    expect(mark.classes()).toContain('font-mono')

    vi.setSystemTime(new Date(2026, 9, 25, 14, 3))
    clearApprovalRecords()
    const denied = await decide({ issueKey: 'DS-11', status: 'done' }, false, {
      state: 'output-denied',
    })
    expect(denied.get('[data-testid="approval-outcome"]').text()).toBe('– Denied by you at 14:03.')
    expect(denied.get('[data-testid="approval-outcome-mark"]').classes()).not.toContain(
      'text-success',
    )
  })

  it('records a typed failure in one short line, leaving the ErrorCard to explain', async () => {
    // S-E said the failure three times: the card, the ErrorCard and the reply.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 25, 14, 2))

    const failed = await decide({ issueKey: 'DS-42', status: 'done' }, true, {
      state: 'output-available',
      output: {
        ok: false,
        error: {
          code: 'ISSUE_NOT_FOUND',
          message:
            "No issue with key 'DS-42'. Search by title to find the issue you meant (search_issues).",
        },
      },
    })
    const outcome = failed.get('[data-testid="approval-outcome"]')
    // The code is the ErrorCard's, right below; here it wrapped the line at 1440.
    expect(outcome.text()).toBe('✕ Approved by you at 14:02 — not applied.')
    expect(outcome.classes()).toContain('text-destructive')
    expect(outcome.text()).not.toContain('search_issues')
    expect(outcome.text()).not.toContain('ISSUE_NOT_FOUND')
    // No board status to keep for an issue the board never held.
    expect(failed.get('[data-testid="approval-headline"]').text()).toBe('DS-42: Done')
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

  it('surfaces a failed write rather than implying it worked', () => {
    const wrapper = mountCard({
      ...requested({ issueKey: 'DS-42', status: 'done' }),
      state: 'output-available',
      output: { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: 'no' } },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    const outcome = wrapper.get('[data-testid="approval-outcome"]')
    expect(outcome.text()).toContain('not applied')
    expect(outcome.classes()).toContain('text-destructive')
  })

  it('records an approval as soon as it is given', () => {
    const wrapper = mountCard({
      ...requested({ issueKey: 'DS-7', status: 'done' }),
      state: 'approval-responded',
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(wrapper.get('[data-testid="approval-outcome"]').text()).toBe('◐ Approved by you.')
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

  it('spends the Ink on Approve only when it leads its region', () => {
    const lead = mountCard(requested({ issueKey: 'DS-7', status: 'done' }))
    expect(isInk(lead, 'approval-approve')).toBe(true)
    expect(isInk(lead, 'approval-deny')).toBe(false)

    // The second of five open cards decides in outline, with the same buttons.
    const follower = mountCard(requested({ issueKey: 'DS-8', status: 'done' }), { lead: false })
    expect(isInk(follower, 'approval-approve')).toBe(false)
    expect(isInk(follower, 'approval-deny')).toBe(false)
  })

  it('warns before asking to change an issue the board does not hold (S-E)', () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-42', status: 'done' }))

    const warning = wrapper.get('[data-testid="approval-warning"]')
    expect(warning.text()).toBe('DS-42 isn’t on the board.')
    expect(warning.classes()).toContain('text-destructive')
    // The decision group carries the warning, so focus landing there hears it.
    expect(wrapper.get('[data-approval-focus]').attributes('aria-describedby')).toBe(
      warning.attributes('id'),
    )
    // Deny is the default; Approve is demoted, not removed.
    expect(isInk(wrapper, 'approval-deny')).toBe(true)
    expect(isInk(wrapper, 'approval-approve')).toBe(false)
  })

  it('finds the issue for a lowercase or padded key, as the api does', () => {
    // The api trims and case-folds the key, so this change would land; warning
    // here would push the person to deny a valid write.
    for (const issueKey of ['ds-7', '  DS-7 ']) {
      const wrapper = mountCard(requested({ issueKey, status: 'done' }))
      expect(wrapper.find('[data-testid="approval-warning"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe('DS-7: In review → Done')
      expect(wrapper.text()).toContain('Billing export CSV download')
      expect(isInk(wrapper, 'approval-approve')).toBe(true)
      expect(isInk(wrapper, 'approval-deny')).toBe(false)
    }
  })

  it('still lets a change to a missing issue be approved, so its typed error comes back', async () => {
    const wrapper = mountCard(requested({ issueKey: 'DS-42', status: 'done' }))

    await wrapper.get('[data-testid="approval-approve"]').trigger('click')

    expect(addToolApprovalResponse).toHaveBeenCalledWith({ id: 'approval-1', approved: true })
  })

  it('gives no warning for an issue on the board, or once the change is decided', () => {
    expect(
      mountCard(requested({ issueKey: 'DS-7', status: 'done' }))
        .find('[data-testid="approval-warning"]')
        .exists(),
    ).toBe(false)

    // After the decision the outcome line reports the failure; one record is enough.
    const decided = mountCard({
      ...requested({ issueKey: 'DS-42', status: 'done' }),
      state: 'output-available',
      output: { ok: false, error: { code: 'ISSUE_NOT_FOUND', message: 'no' } },
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(decided.find('[data-testid="approval-warning"]').exists()).toBe(false)
  })
})
