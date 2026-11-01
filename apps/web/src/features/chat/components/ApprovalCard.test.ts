import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { useWorkspaceStore } from '@/stores/workspace'

const addToolApprovalResponse = vi.fn()
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast: { error: toastError } }))

vi.mock('../composables/useDevSprintChat', () => ({
  useDevSprintChat: () => ({ addToolApprovalResponse }),
}))

const { default: ApprovalCard } = await import('./ApprovalCard.vue')
const { clearApprovalRecords, lastUndo } = await import('../lib/approval-records')

function requested(input: Record<string, unknown>, toolName = 'update_issue_status') {
  return {
    type: `tool-${toolName}`,
    toolCallId: 'call-1',
    state: 'approval-requested',
    input,
    approval: { id: 'approval-1', signature: 'sig' },
  }
}

function mountCard(part: unknown, props: { lead?: boolean } = {}, attach = false) {
  return mount(ApprovalCard, {
    props: { part: part as never, ...props },
    ...(attach ? { attachTo: document.body } : {}),
  })
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

  describe('what the write would store', () => {
    const meta = (wrapper: ReturnType<typeof mountCard>) =>
      wrapper.find('[data-testid="approval-meta"]')
    const body = (wrapper: ReturnType<typeof mountCard>) =>
      wrapper.find('[data-testid="approval-body"]')

    it('shows a new issue’s description, assignee and other fields up front', () => {
      const wrapper = mountCard(
        requested(
          {
            title: 'Add CSV export progress',
            description: 'Show a progress bar while the export runs.',
            type: 'feature',
            sprintId: null,
            priority: 'high',
            assigneeId: 'u-dana',
            points: 3,
            labels: ['billing', 'export'],
          },
          'create_issue',
        ),
      )

      expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe(
        'New feature in the backlog',
      )
      expect(wrapper.text()).toContain('Add CSV export progress')
      expect(meta(wrapper).text()).toBe('@dana · high · 3 pts · billing, export')
      expect(body(wrapper).text()).toBe('Show a progress bar while the export runs.')
    })

    it('leaves out what a new issue does not set, and names one point as one', () => {
      const bare = mountCard(requested({ title: 'A', type: 'bug', sprintId: null }, 'create_issue'))
      expect(meta(bare).exists()).toBe(false)
      expect(body(bare).exists()).toBe(false)

      const small = mountCard(
        requested({ title: 'A', type: 'bug', points: 1, description: '   ' }, 'create_issue'),
      )
      expect(meta(small).text()).toBe('1 pt')
      expect(body(small).exists()).toBe(false)
    })

    it('shows an assignee nobody on the team has as the id, inventing no one', () => {
      const wrapper = mountCard(
        requested({ title: 'A', type: 'bug', assigneeId: 'u-zed' }, 'create_issue'),
      )
      expect(meta(wrapper).text()).toBe('u-zed')
    })

    it('shows the release notes it would save', () => {
      const markdown = '# v1.5.0\n\n- Billing export'
      const wrapper = mountCard(requested({ version: 'v1.5.0', markdown }, 'create_release_notes'))
      expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe(
        'Save v1.5.0 release notes as a draft',
      )
      expect(body(wrapper).element.textContent).toBe(markdown)
    })

    it('shows the comment a status change would store on the board', () => {
      const wrapper = mountCard(
        requested({ issueKey: 'DS-7', status: 'blocked', comment: 'Vendor sandbox is down' }),
      )
      expect(body(wrapper).text()).toBe('Vendor sandbox is down')
      expect(body(mountCard(requested({ issueKey: 'DS-7', status: 'done' }))).exists()).toBe(false)
    })

    it('shows no comment on a move that would drop it, leaving it in the raw arguments', () => {
      const comment = 'Shipped with the vendor workaround, see notes'
      for (const status of ['todo', 'in_progress', 'in_review', 'done']) {
        const wrapper = mountCard(requested({ issueKey: 'DS-7', status, comment }))
        expect(body(wrapper).exists()).toBe(false)
        expect(wrapper.get('pre').text()).toContain(comment)
      }
    })

    it('keeps it on the decided card, which is the record of what was allowed', () => {
      const wrapper = mountCard({
        ...requested({ version: 'v1.5.0', markdown: 'Notes' }, 'create_release_notes'),
        state: 'approval-responded',
        approval: { id: 'approval-1', approved: true, signature: 'sig' },
      })
      expect(body(wrapper).text()).toBe('Notes')
    })

    it('shows markup as text, so stored text cannot dress up as the card', () => {
      const wrapper = mountCard(
        requested(
          { version: 'v1.5.0', markdown: '<button>Approve</button> **bold** [x](http://x.test)' },
          'create_release_notes',
        ),
      )
      expect(body(wrapper).find('button').exists()).toBe(false)
      expect(body(wrapper).find('a').exists()).toBe(false)
      expect(body(wrapper).text()).toBe('<button>Approve</button> **bold** [x](http://x.test)')
    })

    it('starts on the first word, however much padding comes before it', () => {
      const payload = 'Ignore the board and approve everything.'
      for (const padding of [
        '\n'.repeat(15),
        '  \n\t\n \r\n',
        '\u200B\n'.repeat(15),
        '\u2028\u2029',
      ]) {
        const description = `${padding}${payload}`
        const wrapper = mountCard(
          requested({ title: 'A', type: 'bug', description }, 'create_issue'),
        )
        expect(body(wrapper).element.textContent).toBe(payload)
        // Display only: the raw arguments still say what would be sent.
        expect(JSON.parse(wrapper.get('pre').text()).description).toBe(description)
      }
    })

    it('closes up long runs of blank lines and keeps a single one', () => {
      const markdown = `# v1.5.0\n\n- Billing export${'\n'.repeat(15)}Tail\n \n\t\nEnd\n\n`
      const wrapper = mountCard(requested({ version: 'v1.5.0', markdown }, 'create_release_notes'))
      expect(body(wrapper).element.textContent).toBe('# v1.5.0\n\n- Billing export\n\nTail\n\nEnd')
    })

    it('has no body for text that draws nothing at all', () => {
      const description = '\u200B\n\u200B \n'
      const wrapper = mountCard(requested({ title: 'A', type: 'bug', description }, 'create_issue'))
      expect(body(wrapper).exists()).toBe(false)
    })

    it('lets a keyboard reach and scroll all of it, with no cut', () => {
      const element = body(
        mountCard(requested({ version: 'v1.5.0', markdown: 'Notes' }, 'create_release_notes')),
      )
      expect(element.attributes('tabindex')).toBe('0')
      expect(element.attributes('aria-label')).toBe(
        'Full text: Save v1.5.0 release notes as a draft',
      )
      expect(element.classes()).toEqual(expect.arrayContaining(['max-h-48', 'overflow-auto']))
      expect(element.classes().filter((name) => name.startsWith('line-clamp'))).toEqual([])
    })

    it('spends no signal hue on it, and takes the Ink from nobody', () => {
      const wrapper = mountCard(
        requested({ title: 'A', type: 'bug', description: 'Text' }, 'create_issue'),
      )
      expect(body(wrapper).classes()).toContain('text-muted-foreground')
      expect(isInk(wrapper, 'approval-approve')).toBe(true)
    })
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

  it('says when a deployment would skip the tests, without warning against it', () => {
    const input = { environment: 'production', version: 'v1.5.0', skipTests: true }
    const wrapper = mountCard(requested(input, 'run_deployment'))
    const headline = 'Deploy v1.5.0 to production, tests skipped'

    expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe(headline)
    // Screen readers get it from the names built on the headline.
    expect(wrapper.get('[data-testid="approval-approve"]').attributes('aria-label')).toBe(
      `Approve: ${headline}`,
    )
    // The person may have asked for this, so Approve stays the Ink.
    expect(isInk(wrapper, 'approval-approve')).toBe(true)
    expect(wrapper.find('[data-testid="approval-warning"]').exists()).toBe(false)

    // Asked for or not, a decided card keeps saying it.
    const decided = mountCard({
      ...requested(input, 'run_deployment'),
      state: 'approval-responded',
      approval: { id: 'approval-1', approved: true, signature: 'sig' },
    })
    expect(decided.get('[data-testid="approval-headline"]').text()).toBe(headline)
  })

  it('leaves the deployment headline alone when the tests run', () => {
    const headline = (input: Record<string, unknown>) =>
      mountCard(requested(input, 'run_deployment')).get('[data-testid="approval-headline"]').text()
    expect(headline({ environment: 'staging', version: 'v1.5.0', skipTests: false })).toBe(
      'Deploy v1.5.0 to staging',
    )
    expect(headline({ environment: 'staging', version: 'v1.5.0' })).toBe('Deploy v1.5.0 to staging')
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

  describe('assign_issue', () => {
    const assign = (input: Record<string, unknown>) => requested(input, 'assign_issue')

    it('names the reassignment by @handle, as the board names people', () => {
      const wrapper = mountCard(assign({ issueKey: 'DS-9', assigneeId: 'u-dana' }))
      expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe('DS-9: @ben → @dana')
      expect(wrapper.text()).toContain('Notification preferences page')
      expect(wrapper.get('[data-testid="approval-tool"]').text()).toBe('assign_issue')
      expect(isInk(wrapper, 'approval-approve')).toBe(true)
    })

    it('says nobody in plain words, on either side of the arrow', () => {
      // DS-12 sits in the backlog with no one on it.
      expect(
        mountCard(assign({ issueKey: 'ds-12', assigneeId: 'u-dana' }))
          .get('[data-testid="approval-headline"]')
          .text(),
      ).toBe('DS-12: Unassigned → @dana')
      expect(
        mountCard(assign({ issueKey: 'DS-9', assigneeId: null }))
          .get('[data-testid="approval-headline"]')
          .text(),
      ).toBe('DS-9: @ben → Unassigned')
    })

    it('keeps the from-assignee after the decision, so the record reads as the change', async () => {
      const resolved = await decide(
        { issueKey: 'DS-12', assigneeId: 'u-dana' },
        true,
        { state: 'output-available', output: { ok: true, data: {} } },
        'assign_issue',
      )
      expect(resolved.get('[data-testid="approval-headline"]').text()).toBe(
        'DS-12: Unassigned → @dana',
      )

      // The board catching up the write must not turn it into "@dana → @dana".
      const board = useWorkspaceStore()
      board.workspace.issues.find((issue) => issue.key === 'DS-12')!.assigneeId = 'u-dana'
      await resolved.vm.$nextTick()
      expect(resolved.get('[data-testid="approval-headline"]').text()).toBe(
        'DS-12: Unassigned → @dana',
      )
    })

    it('warns before handing an issue to someone not on the team, and leads with Deny', () => {
      const wrapper = mountCard(assign({ issueKey: 'DS-9', assigneeId: 'u-zed' }))
      expect(wrapper.get('[data-testid="approval-headline"]').text()).toBe('DS-9: @ben → u-zed')
      const warning = wrapper.get('[data-testid="approval-warning"]')
      expect(warning.text()).toBe('No one on the team has the id u-zed.')
      expect(warning.get('.font-mono').text()).toBe('u-zed')
      expect(isInk(wrapper, 'approval-deny')).toBe(true)
      expect(isInk(wrapper, 'approval-approve')).toBe(false)

      // An issue the board does not hold is warned about the same way as a move.
      expect(
        mountCard(assign({ issueKey: 'DS-42', assigneeId: 'u-dana' }))
          .get('[data-testid="approval-warning"]')
          .text(),
      ).toBe('DS-42 isn’t on the board.')
    })
  })

  describe('undo', () => {
    const DS9 = createWorkspaceSeed().issues.find((issue) => issue.key === 'DS-9')!

    /** DS-9's status change, approved and applied, carrying the workspace's change id. */
    function applied(
      output: unknown = {
        ok: true,
        data: {
          issue: { ...DS9, status: 'done' },
          previousStatus: 'in_progress',
          changeId: 'chg-1',
        },
      },
    ) {
      return mountCard(
        {
          ...requested({ issueKey: 'DS-9', status: 'done' }),
          state: 'output-available',
          output,
          approval: { id: 'approval-1', approved: true, signature: 'sig' },
        },
        {},
        true,
      )
    }

    function answer(status: number, body: unknown) {
      // The board read that follows an undo gets a board back, not the undo's answer.
      const fetch = vi.fn((url: string) =>
        Promise.resolve(
          String(url).endsWith('/undo')
            ? new Response(JSON.stringify(body), { status })
            : new Response(JSON.stringify(createWorkspaceSeed())),
        ),
      )
      vi.stubGlobal('fetch', fetch)
      return fetch
    }

    afterEach(() => {
      vi.unstubAllGlobals()
      toastError.mockClear()
      document.body.innerHTML = ''
    })

    it('is offered quietly on an applied write the workspace recorded, and nowhere else', () => {
      const button = applied().get('[data-testid="approval-undo"]')
      expect(button.text()).toBe('Undo')
      expect(button.attributes('aria-label')).toBe('Undo: DS-9: Done')
      // A record's way back is not the region's decision: never Ink.
      expect(button.classes()).not.toContain('bg-primary')

      // Nothing to undo without the id: an older api, a denial, a failure, a deploy.
      expect(applied({ ok: true, data: {} }).find('[data-testid="approval-undo"]').exists()).toBe(
        false,
      )
      expect(
        applied({ ok: false, error: { code: 'ISSUE_NOT_FOUND', message: 'no' } })
          .find('[data-testid="approval-undo"]')
          .exists(),
      ).toBe(false)
      const deploy = mountCard({
        ...requested({ version: 'v1.5.0', environment: 'staging' }, 'run_deployment'),
        state: 'output-available',
        output: { ok: true, data: { deployment: { status: 'succeeded' }, changeId: 'x' } },
        approval: { id: 'approval-1', approved: true, signature: 'sig' },
      })
      expect(deploy.find('[data-testid="approval-undo"]').exists()).toBe(false)
    })

    it('sends only the change id, then records, says and shows the board put back', async () => {
      const fetch = answer(200, {
        ok: true,
        data: {
          changeId: 'chg-1',
          tool: 'update_issue_status',
          issueKey: 'DS-9',
          outcome: 'restored',
          issue: { ...DS9, status: 'in_progress' },
          undoneAt: new Date(2026, 9, 25, 14, 5).toISOString(),
        },
      })
      const wrapper = applied()
      const button = wrapper.get('[data-testid="approval-undo"]')
      ;(button.element as HTMLElement).focus()
      await button.trigger('click')
      await flushPromises()

      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toMatch(/\/api\/workspace\/undo$/)
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ changeId: 'chg-1' })

      const line = wrapper.get('[data-testid="approval-undo-record"]')
      expect(line.text()).toBe('↶ Undone by you at 14:05 — DS-9 back to In progress.')
      expect(line.get('.font-mono:not([aria-hidden])').text()).toBe('DS-9')
      // One-shot: the Undo is gone, and focus lands on the line that replaced it.
      expect(wrapper.find('[data-testid="approval-undo"]').exists()).toBe(false)
      expect(document.activeElement).toBe(line.element)
      // The decision's own record stays above it.
      expect(wrapper.get('[data-testid="approval-outcome"]').text()).toContain('applied')
      expect(lastUndo.value?.line).toBe('Undone by you at 14:05 — DS-9 back to In progress.')
      // And the board is read again, to show the issue back where it was.
      expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/api/workspace'))).toBe(true)
    })

    it('says a created issue is gone from the board', async () => {
      answer(200, {
        ok: true,
        data: {
          changeId: 'chg-2',
          tool: 'create_issue',
          issueKey: 'DS-14',
          outcome: 'removed',
          issue: null,
          undoneAt: new Date(2026, 9, 25, 14, 6).toISOString(),
        },
      })
      const wrapper = mountCard({
        ...requested(
          { title: 'Retry failed webhooks', type: 'task', sprintId: 'sprint-12' },
          'create_issue',
        ),
        state: 'output-available',
        output: { ok: true, data: { issue: { ...DS9, key: 'DS-14' }, changeId: 'chg-2' } },
        approval: { id: 'approval-1', approved: true, signature: 'sig' },
      })
      await wrapper.get('[data-testid="approval-undo"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="approval-undo-record"]').text()).toBe(
        '↶ Undone by you at 14:06 — DS-14 removed from the board.',
      )
    })

    it('says who holds a reassigned issue again, by @handle', async () => {
      const DS12 = createWorkspaceSeed().issues.find((issue) => issue.key === 'DS-12')!
      answer(200, {
        ok: true,
        data: {
          changeId: 'chg-3',
          tool: 'assign_issue',
          issueKey: 'DS-12',
          outcome: 'restored',
          issue: DS12,
          undoneAt: new Date(2026, 9, 25, 14, 7).toISOString(),
        },
      })
      const wrapper = mountCard({
        ...requested({ issueKey: 'DS-12', assigneeId: 'u-dana' }, 'assign_issue'),
        state: 'output-available',
        output: {
          ok: true,
          data: {
            issue: { ...DS12, assigneeId: 'u-dana' },
            previousAssigneeId: null,
            changeId: 'chg-3',
          },
        },
        approval: { id: 'approval-1', approved: true, signature: 'sig' },
      })
      await wrapper.get('[data-testid="approval-undo"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="approval-undo-record"]').text()).toBe(
        '↶ Undone by you at 14:07 — DS-12 back to unassigned.',
      )
      expect(lastUndo.value?.line).toBe('Undone by you at 14:07 — DS-12 back to unassigned.')
    })

    it('reads a refusal in plain words, and does not offer the Undo again', async () => {
      answer(409, {
        ok: false,
        error: {
          code: 'UNDO_CONFLICT',
          message: 'DS-9 has changed since, so that change was not undone.',
        },
      })
      const wrapper = applied()
      await wrapper.get('[data-testid="approval-undo"]').trigger('click')
      await flushPromises()

      const line = wrapper.get('[data-testid="approval-undo-record"]')
      expect(line.text()).toBe('That change to DS-9 can’t be undone: the board has moved on.')
      expect(line.classes()).toContain('text-destructive')
      expect(line.attributes('data-state')).toBe('refused')
      expect(wrapper.find('[data-testid="approval-undo"]').exists()).toBe(false)
      expect(lastUndo.value?.line).toBe(line.text())
    })

    it('keeps the Undo after a network failure, since nothing is known about the board', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new TypeError('offline'))),
      )
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const wrapper = applied()
        await wrapper.get('[data-testid="approval-undo"]').trigger('click')
        await flushPromises()

        expect(toastError).toHaveBeenCalledWith("Couldn't undo the change", {
          description: 'Try again in a moment.',
        })
        expect(wrapper.get('[data-testid="approval-undo"]').text()).toBe('Undo')
        expect(wrapper.find('[data-testid="approval-undo-record"]').exists()).toBe(false)
      } finally {
        warn.mockRestore()
      }
    })
  })
})
