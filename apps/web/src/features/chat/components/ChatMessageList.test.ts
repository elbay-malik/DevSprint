import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import type { DevSprintUIMessage } from '../types'

const DEPLOYMENT = {
  id: 'dep-99',
  projectId: 'proj-1',
  version: 'v1.5.0',
  environment: 'staging',
  status: 'running',
  commitSha: 'abc1234',
  triggeredById: 'agent',
  startedAt: '2026-07-01T09:00:00Z',
  finishedAt: null,
  stages: [{ name: 'build', status: 'running', startedAt: null, finishedAt: null, logTail: [] }],
}

const sendMessage = vi.fn()
const chat = reactive({ messages: [] as DevSprintUIMessage[], status: 'ready', sendMessage })

vi.mock('../composables/useDevSprintChat', () => ({
  useDevSprintChat: () => chat,
}))

const { toastError, MCP_URL } = vi.hoisted(() => ({
  toastError: vi.fn(),
  MCP_URL: 'https://devsprint-mcp-issues.example.dev/mcp',
}))
vi.mock('vue-sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  MCP_ENDPOINT: MCP_URL,
}))

const { default: ChatMessageList } = await import('./ChatMessageList.vue')
const { approvalRecord, clearApprovalRecords, recordDecision, recordUndo } =
  await import('../lib/approval-records')

// Every mounted list watches the shared `chat`; one left mounted would keep
// reacting to later tests' changes and moving focus in trees no longer shown.
enableAutoUnmount(afterEach)
// Decisions are kept by approval id for the session, and every spec reuses ids.
beforeEach(() => {
  clearApprovalRecords()
})

/** An assistant turn holding one tool call that never produced a result. */
function abandonedTurn(id: string): DevSprintUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-get_sprint_status',
        toolCallId: `${id}-call`,
        state: 'input-available',
        input: {},
      },
    ],
  }
}

describe('ChatMessageList', () => {
  // Cards below this list read the workspace store, so every mount needs one.
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('only lets the streaming message claim to be running', () => {
    // Turn 1 was stopped mid-call; turn 2 is streaming now.
    chat.messages = [abandonedTurn('m1'), abandonedTurn('m2')]
    chat.status = 'streaming'

    const wrapper = mount(ChatMessageList)
    const states = wrapper.findAll('[data-testid="tool-call-state"]').map((el) => el.text())

    // The abandoned call can never finish, so it must not animate as running
    // just because a later turn is in flight.
    expect(states).toEqual(['stopped', 'running…'])
  })

  it('shows nothing as running once the chat is idle', () => {
    chat.messages = [abandonedTurn('m1')]
    chat.status = 'ready'

    const wrapper = mount(ChatMessageList)

    expect(wrapper.get('[data-testid="tool-call-state"]').text()).toBe('stopped')
  })

  it('gives a successful burndown result its chart, not the fallback chip', () => {
    chat.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-get_burndown',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: {
              ok: true,
              data: {
                sprintId: 'sprint-12',
                unit: 'points',
                committedPoints: 31,
                asOf: '2026-07-01T09:00:00Z',
                days: [
                  { date: '2026-06-22', remaining: 31, ideal: 31 },
                  { date: '2026-07-05', remaining: 23, ideal: 0 },
                ],
              },
            },
          },
        ],
      },
    ]
    chat.status = 'ready'

    const wrapper = mount(ChatMessageList)

    expect(wrapper.find('[data-testid="burndown-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tool-call-chip"]').exists()).toBe(false)
  })

  it('gives a gated write its approval card and nothing else', () => {
    // The approval card owns a gated call for its whole life, so the decision
    // stays on screen as the audit record. Rendering a result card beside it
    // says the same call twice, and says it without the decision attached.
    chat.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-update_issue_status',
            toolCallId: 'c1',
            state: 'output-available',
            input: { issueKey: 'DS-7', status: 'done' },
            approval: { id: 'a1', approved: true },
            output: { ok: true, data: { issue: { key: 'DS-7' } } },
          },
        ],
      } as unknown as DevSprintUIMessage,
    ]
    chat.status = 'ready'

    const wrapper = mount(ChatMessageList)

    expect(wrapper.findAll('[data-testid="approval-card"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="tool-call-chip"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="issue-table"]').exists()).toBe(false)
  })

  it('gives an approved write that failed its error card too (S-E)', () => {
    chat.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-update_issue_status',
            toolCallId: 'c1',
            state: 'output-available',
            input: { issueKey: 'DS-42', status: 'done' },
            approval: { id: 'a1', approved: true },
            output: {
              ok: false,
              error: { code: 'ISSUE_NOT_FOUND', message: "No issue with key 'DS-42'." },
            },
          },
        ],
      } as unknown as DevSprintUIMessage,
    ]
    chat.status = 'ready'

    const wrapper = mount(ChatMessageList)

    // The decision stays recorded, and the typed error is not reduced to a
    // footnote on it.
    expect(wrapper.findAll('[data-testid="approval-card"]')).toHaveLength(1)
    const error = wrapper.find('[data-testid="error-card"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('ISSUE_NOT_FOUND')
  })

  it('shows a deployment awaiting its gate as the approval card alone (S-C step 3)', () => {
    // Until it is approved there is no run to draw, and a chip of the same call
    // under the card would say it twice — once without the decision attached.
    chat.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-run_deployment',
            toolCallId: 'c1',
            state: 'approval-requested',
            input: { environment: 'staging', version: 'v1.5.0-rc.1' },
            approval: { id: 'a1' },
          },
        ],
      } as unknown as DevSprintUIMessage,
    ]
    chat.status = 'ready'

    const wrapper = mount(ChatMessageList)

    expect(wrapper.findAll('[data-testid="approval-card"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="tool-call-chip"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="deployment-progress"]').exists()).toBe(false)
  })

  it('gives a gated deployment both cards, because it is gated and long-running', () => {
    chat.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-run_deployment',
            toolCallId: 'c1',
            state: 'output-available',
            input: { environment: 'staging', version: 'v1.5.0' },
            approval: { id: 'a1', approved: true },
            output: { ok: true, data: { deployment: DEPLOYMENT } },
          },
        ],
      } as unknown as DevSprintUIMessage,
    ]
    chat.status = 'ready'

    const wrapper = mount(ChatMessageList)

    // The approval says who allowed it; the progress card shows the run itself.
    expect(wrapper.findAll('[data-testid="approval-card"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="deployment-progress"]')).toHaveLength(1)
  })

  it('renders text parts and tool chips in transcript order', () => {
    chat.messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Checking the sprint.' },
          {
            type: 'tool-get_sprint_status',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: { ok: true, data: {} },
          },
          { type: 'text', text: 'Five issues are open.' },
        ],
      } as DevSprintUIMessage,
    ]
    chat.status = 'ready'

    const wrapper = mount(ChatMessageList)
    const text = wrapper.text()

    expect(text.indexOf('Checking the sprint.')).toBeLessThan(text.indexOf('get_sprint_status'))
    expect(text.indexOf('get_sprint_status')).toBeLessThan(text.indexOf('Five issues are open.'))
  })

  it('names each message for its speaker inside a conversation log that does not speak', () => {
    chat.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Is the sprint on track?' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Mostly.' }] },
    ]
    chat.status = 'ready'

    const wrapper = mount(ChatMessageList)

    const log = wrapper.get('[role="log"]')
    expect(log.attributes('aria-label')).toBe('Conversation')
    // The status line announces; a live log would read every token out.
    expect(log.attributes('aria-live')).toBe('off')
    const messages = wrapper.findAll('[data-testid="chat-message"]')
    expect(messages.map((m) => m.element.tagName)).toEqual(['ARTICLE', 'ARTICLE'])
    expect(messages.map((m) => m.attributes('aria-label'))).toEqual(['You', 'Copilot'])
  })
})

/** A gated status change, asking or answered. */
function gated(
  id: string,
  issueKey: string,
  state = 'approval-requested',
  approved?: boolean,
  reason?: string,
) {
  return {
    type: 'tool-update_issue_status',
    toolCallId: id,
    state,
    input: { issueKey, status: 'done' },
    approval: {
      id: `a-${id}`,
      ...(approved === undefined ? {} : { approved }),
      ...(reason === undefined ? {} : { reason }),
    },
  }
}

function turnWith(parts: unknown[]): DevSprintUIMessage {
  return { id: 'a1', role: 'assistant', parts } as unknown as DevSprintUIMessage
}

/** The list inside a pane with a composer, as ChatPane lays it out. */
const Pane = defineComponent(
  () => () =>
    h('section', { 'data-testid': 'chat-pane' }, [
      h(ChatMessageList),
      h('input', { 'data-chat-composer': '', 'aria-label': 'Message the copilot' }),
    ]),
)

describe('ChatMessageList status and focus', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    chat.messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Close it out' }] }]
    chat.status = 'ready'
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const status = (wrapper: ReturnType<typeof mount>) =>
    wrapper.get('[data-testid="chat-status"]').text()

  it('announces the turn starting and the reply arriving, not the stream itself', async () => {
    const wrapper = mount(ChatMessageList)

    chat.status = 'submitted'
    await nextTick()
    expect(status(wrapper)).toBe('The copilot is working on your request…')

    chat.messages = [...chat.messages, turnWith([{ type: 'text', text: 'Five issues are open.' }])]
    chat.status = 'streaming'
    await nextTick()
    expect(status(wrapper)).not.toContain('Five issues')

    chat.status = 'ready'
    await nextTick()
    expect(status(wrapper)).toBe('Copilot replied.')
  })

  it('says nothing replied when the turn was stopped before a word came back', async () => {
    const wrapper = mount(ChatMessageList)
    chat.status = 'submitted'
    await nextTick()
    chat.status = 'ready'
    await nextTick()
    expect(status(wrapper)).toBe('')
  })

  it('announces open approvals and moves focus to the first card', async () => {
    const wrapper = mount(Pane, { attachTo: document.body })
    chat.status = 'submitted'
    await nextTick()
    chat.messages = [...chat.messages, turnWith([gated('c1', 'DS-7'), gated('c2', 'DS-9')])]
    chat.status = 'streaming'
    await nextTick()

    chat.status = 'ready'
    await nextTick()

    expect(status(wrapper)).toBe('2 changes need your approval.')
    const first = wrapper.get('[data-call-id="c1"] [data-approval-focus]').element
    expect(document.activeElement).toBe(first)
  })

  it('brings the group header into view with the first card, not just its buttons', async () => {
    const scrolled: { el: Element; block: unknown }[] = []
    Element.prototype.scrollIntoView = vi.fn(function (this: Element, arg?: unknown) {
      scrolled.push({ el: this, block: (arg as ScrollIntoViewOptions | undefined)?.block })
    })
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      const wrapper = mount(Pane, { attachTo: document.body })
      chat.status = 'submitted'
      await nextTick()
      chat.messages = [...chat.messages, turnWith([gated('c1', 'DS-7'), gated('c2', 'DS-9')])]
      chat.status = 'streaming'
      await nextTick()
      chat.status = 'ready'
      await nextTick()

      // The browser's own focus scroll would hide the header and headline.
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
      // So the pane stops pinning the transcript to its bottom.
      expect(wrapper.findComponent(ChatMessageList).emitted('reveal')).toHaveLength(1)
      expect(scrolled[0]).toEqual({
        el: wrapper.get('[data-testid="approval-group-header"]').element,
        block: 'start',
      })
      expect(scrolled.at(-1)).toEqual({
        el: wrapper.get('[data-call-id="c1"] [data-approval-focus]').element,
        block: 'nearest',
      })
    } finally {
      focus.mockRestore()
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('announces each decision and moves on to the next open card, then the composer', async () => {
    chat.messages = [
      ...chat.messages,
      turnWith([gated('c1', 'DS-7'), gated('c2', 'DS-9'), gated('c3', 'DS-11')]),
    ]
    const wrapper = mount(Pane, { attachTo: document.body })
    const parts = chat.messages.at(-1)!.parts as unknown as ReturnType<typeof gated>[]

    // The middle card first, so "next" has to mean after it, not the first.
    parts[1] = gated('c2', 'DS-9', 'approval-responded', true)
    await nextTick()
    expect(status(wrapper)).toBe('Approved by you. 2 changes need your approval.')
    expect(document.activeElement).toBe(
      wrapper.get('[data-call-id="c3"] [data-approval-focus]').element,
    )

    parts[2] = gated('c3', 'DS-11', 'approval-responded', false, 'Blocked')
    await nextTick()
    expect(status(wrapper)).toBe('Denied by you: “Blocked”. 1 change needs your approval.')
    expect(document.activeElement).toBe(
      wrapper.get('[data-call-id="c1"] [data-approval-focus]').element,
    )

    parts[0] = gated('c1', 'DS-7', 'approval-responded', true)
    await nextTick()
    expect(status(wrapper)).toBe('Approved by you.')
    expect(document.activeElement).toBe(wrapper.get('[data-chat-composer]').element)

    // Answering the last card resends at once; the decision rides along so a
    // screen reader that only reads the latest change still hears it.
    chat.status = 'submitted'
    await nextTick()
    expect(status(wrapper)).toBe('Approved by you. The copilot is working on your request…')
  })

  it('announces the time a decision was made, as the card records it', async () => {
    chat.messages = [...chat.messages, turnWith([gated('c1', 'DS-7'), gated('c2', 'DS-9')])]
    const wrapper = mount(ChatMessageList)
    const parts = chat.messages.at(-1)!.parts as unknown as ReturnType<typeof gated>[]

    // The card records the decision before it answers the SDK.
    recordDecision('a-c1', { decidedAt: new Date(2026, 9, 25, 14, 2), from: 'in_review' })
    parts[0] = gated('c1', 'DS-7', 'approval-responded', true)
    await nextTick()

    expect(status(wrapper)).toBe('Approved by you at 14:02. 1 change needs your approval.')
  })

  it('says how each approved write went before the reply, failures first', async () => {
    // Both were approved last step; the writes run on the request that follows.
    const parts: unknown[] = [
      gated('c1', 'DS-7', 'approval-responded', true),
      gated('c2', 'DS-42', 'approval-responded', true),
    ]
    chat.messages = [...chat.messages, turnWith(parts)]
    const wrapper = mount(ChatMessageList)

    chat.status = 'submitted'
    await nextTick()
    parts[0] = {
      ...gated('c1', 'DS-7', 'output-available', true),
      output: { ok: true, data: {} },
    }
    parts[1] = {
      ...gated('c2', 'DS-42', 'output-available', true),
      output: {
        ok: false,
        error: { code: 'ISSUE_NOT_FOUND', message: 'No issue with key DS-42.' },
      },
    }
    parts.push({ type: 'text', text: 'DS-7 is done; DS-42 does not exist.' })
    chat.status = 'streaming'
    await nextTick()
    chat.status = 'ready'
    await nextTick()

    // One update, so a screen reader hears the failure the card shows.
    expect(status(wrapper)).toBe(
      'Approved by you — not applied (ISSUE_NOT_FOUND). Approved by you — applied. Copilot replied.',
    )

    // A later turn does not repeat what an earlier one already said.
    chat.status = 'submitted'
    await nextTick()
    chat.status = 'ready'
    await nextTick()
    expect(status(wrapper)).toBe('Copilot replied.')
  })

  it('leaves focus alone when the user is working outside the chat', async () => {
    const board = document.createElement('button')
    document.body.append(board)
    chat.messages = [...chat.messages, turnWith([gated('c1', 'DS-7'), gated('c2', 'DS-9')])]
    mount(Pane, { attachTo: document.body })
    board.focus()

    chat.status = 'streaming'
    await nextTick()
    chat.status = 'ready'
    await nextTick()
    expect(document.activeElement).toBe(board)

    const parts = chat.messages.at(-1)!.parts as unknown as ReturnType<typeof gated>[]
    parts[0] = gated('c1', 'DS-7', 'approval-responded', true)
    await nextTick()
    expect(document.activeElement).toBe(board)
  })
})

describe('ChatMessageList approve all and undo, said aloud', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    chat.messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Close it out' }] }]
    chat.status = 'ready'
  })
  afterEach(() => {
    document.body.innerHTML = ''
    delete (chat as Partial<typeof chat> & { addToolApprovalResponse?: unknown })
      .addToolApprovalResponse
  })

  const status = (wrapper: ReturnType<typeof mount>) =>
    wrapper.get('[data-testid="chat-status"]').text()

  it('says one press once, when its last card has turned, then moves focus on', async () => {
    chat.messages = [
      ...chat.messages,
      turnWith([gated('c1', 'DS-7'), gated('c2', 'DS-8'), gated('c3', 'DS-42')]),
    ]
    const parts = chat.messages.at(-1)!.parts as unknown as ReturnType<typeof gated>[]
    // The SDK answers each approval as a job of its own: one card at a time.
    const answers: (() => void)[] = []
    Object.assign(chat, {
      addToolApprovalResponse: vi.fn(({ id }: { id: string }) => {
        answers.push(() => {
          const index = parts.findIndex((part) => part.approval.id === id)
          const part = parts[index]!
          parts[index] = gated(part.toolCallId, part.input.issueKey, 'approval-responded', true)
        })
      }),
    })
    const wrapper = mount(Pane, { attachTo: document.body })
    const button = wrapper.get('[data-testid="approval-approve-all"]')
    ;(button.element as HTMLElement).focus()
    await button.trigger('click')

    answers[0]!()
    await nextTick()
    // Half-landed: nothing said yet, and focus stays where the press was.
    expect(status(wrapper)).toBe('')

    answers[1]!()
    await nextTick()
    expect(status(wrapper)).toMatch(
      /^2 changes approved by you at \d\d:\d\d\. 1 change needs your approval\.$/,
    )
    // The one card it left is next.
    expect(document.activeElement).toBe(
      wrapper.get('[data-call-id="c3"] [data-approval-focus]').element,
    )
  })

  it('says the writes one press applied as one line when the turn ends', async () => {
    chat.messages = [
      ...chat.messages,
      turnWith([gated('c1', 'DS-7'), gated('c2', 'DS-8'), gated('c3', 'DS-9')]),
    ]
    const parts = chat.messages.at(-1)!.parts as unknown as Record<string, unknown>[]
    Object.assign(chat, {
      addToolApprovalResponse: vi.fn(({ id }: { id: string }) => {
        const index = parts.findIndex(
          (part) => (part as { approval: { id: string } }).approval.id === id,
        )
        const part = parts[index] as ReturnType<typeof gated>
        parts[index] = gated(part.toolCallId, part.input.issueKey, 'approval-responded', true)
      }),
    })
    const wrapper = mount(Pane, { attachTo: document.body })
    await wrapper.get('[data-testid="approval-approve-all"]').trigger('click')
    await nextTick()

    chat.status = 'submitted'
    await nextTick()
    parts[0] = { ...gated('c1', 'DS-7', 'output-available', true), output: { ok: true, data: {} } }
    parts[1] = { ...gated('c2', 'DS-8', 'output-available', true), output: { ok: true, data: {} } }
    parts[2] = {
      ...gated('c3', 'DS-9', 'output-available', true),
      output: {
        ok: false,
        error: { code: 'ISSUE_NOT_FOUND', message: 'No issue with key DS-9.' },
      },
    }
    chat.status = 'streaming'
    await nextTick()
    chat.status = 'ready'
    await nextTick()

    // The failure on its own, first; the two that applied once, not twice.
    expect(status(wrapper)).toMatch(
      /^Approved by you at (\d\d:\d\d) — not applied \(ISSUE_NOT_FOUND\)\. 2 changes approved by you at \1 — applied\. Copilot replied\.$/,
    )
  })

  it('says an undo on the status line, in the record’s own words', async () => {
    const wrapper = mount(ChatMessageList)
    recordUndo(
      'a-c1',
      {
        state: 'undone',
        copy: ['Undone by you at 14:05 — ', { id: 'DS-9' }, ' back to In progress.'],
      },
      'Undone by you at 14:05 — DS-9 back to In progress.',
    )
    await nextTick()
    expect(status(wrapper)).toBe('Undone by you at 14:05 — DS-9 back to In progress.')
  })
})

describe('ChatMessageList approval groups', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    chat.status = 'ready'
  })

  const points = (key: string) =>
    createWorkspaceSeed().issues.find((issue) => issue.key === key)?.points ?? 0

  const ink = (wrapper: ReturnType<typeof mount>) =>
    wrapper
      .findAll('[data-testid="approval-approve"]')
      .map((button) => button.classes().includes('bg-primary'))

  it('heads two or more open cards with what they add up to on the board', () => {
    chat.messages = [
      turnWith([
        { type: 'text', text: 'Five to close.' },
        gated('c1', 'DS-7'),
        gated('c2', 'DS-8'),
        gated('c3', 'DS-9'),
        gated('c4', 'DS-10'),
        gated('c5', 'DS-11'),
      ]),
    ]
    const wrapper = mount(ChatMessageList)

    const header = wrapper.get('[data-testid="approval-group-count"]')
    expect(header.text()).toBe('5 changes to review · 23 pts')
    // Above the cards, not between them.
    const html = wrapper.html()
    expect(html.indexOf('approval-group-header')).toBeLessThan(html.indexOf('approval-card'))
    // One Ink in the message: Approve all holds it, so every card decides in outline.
    const all = wrapper.get('[data-testid="approval-approve-all"]')
    expect(all.text()).toBe('Approve all 5')
    expect(all.attributes('aria-label')).toBe('Approve all 5 changes')
    expect(all.classes()).toContain('bg-primary')
    expect(ink(wrapper)).toEqual([false, false, false, false, false])
    expect(wrapper.find('[data-testid="approval-group-note"]').exists()).toBe(false)
  })

  it('counts only what is still open, and hands the Ink to the first undecided card', () => {
    chat.messages = [
      turnWith([
        gated('c1', 'DS-7', 'approval-responded', true),
        gated('c2', 'DS-8'),
        // Not on the board, so Approve all would have one card left to offer.
        gated('c3', 'DS-42'),
      ]),
    ]
    const wrapper = mount(ChatMessageList)

    expect(wrapper.get('[data-testid="approval-group-count"]').text()).toBe(
      `2 changes to review · ${points('DS-8')} pts`,
    )
    expect(wrapper.find('[data-testid="approval-approve-all"]').exists()).toBe(false)
    expect(ink(wrapper)).toEqual([true, false])
  })

  it('offers what remains once some cards were answered one by one', () => {
    chat.messages = [
      turnWith([
        gated('c1', 'DS-11', 'approval-responded', false),
        gated('c2', 'DS-7'),
        gated('c3', 'DS-8'),
      ]),
    ]
    const wrapper = mount(ChatMessageList)

    expect(wrapper.get('[data-testid="approval-approve-all"]').text()).toBe('Approve remaining 2')
  })

  it('leaves a deploy and a key the board does not hold to their own decisions, and says so', () => {
    chat.messages = [
      turnWith([
        gated('c1', 'DS-7'),
        gated('c2', 'DS-42'),
        gated('c3', 'DS-8'),
        {
          type: 'tool-run_deployment',
          toolCallId: 'c4',
          state: 'approval-requested',
          input: { version: 'v1.5.0', environment: 'staging' },
          approval: { id: 'a-c4' },
        },
      ]),
    ]
    const wrapper = mount(ChatMessageList)

    expect(wrapper.get('[data-testid="approval-group-count"]').text()).toContain(
      '4 changes to review',
    )
    expect(wrapper.get('[data-testid="approval-approve-all"]').text()).toBe('Approve all 2')
    const note = wrapper.get('[data-testid="approval-group-note"]')
    expect(note.text()).toBe('DS-42 and deploying v1.5.0 to staging need their own decisions.')
    // Identifiers in mono, as everywhere else.
    expect(note.findAll('.font-mono').map((el) => el.text())).toEqual([
      'DS-42',
      'v1.5.0',
      'staging',
    ])
    // The missing key's card gives its Ink Deny up to Approve all, too.
    expect(
      wrapper
        .findAll('[data-testid="approval-deny"]')
        .map((button) => button.classes().includes('bg-primary')),
    ).toEqual([false, false, false, false])
  })

  it('answers each board write on its own, as a press on each card would', async () => {
    const addToolApprovalResponse = vi.fn()
    Object.assign(chat, { addToolApprovalResponse })
    try {
      chat.messages = [turnWith([gated('c1', 'DS-7'), gated('c2', 'DS-42'), gated('c3', 'DS-8')])]
      const wrapper = mount(ChatMessageList)
      await wrapper.get('[data-testid="approval-approve-all"]').trigger('click')

      expect(addToolApprovalResponse.mock.calls).toEqual([
        [{ id: 'a-c1', approved: true }],
        [{ id: 'a-c3', approved: true }],
      ])
      // Each keeps its own record: its from status and the time it was decided.
      expect(approvalRecord('a-c1')?.from).toBe('in_review')
      expect(approvalRecord('a-c3')?.from).toBe(
        createWorkspaceSeed().issues.find((issue) => issue.key === 'DS-8')?.status,
      )
      expect(approvalRecord('a-c2')).toBeUndefined()
    } finally {
      delete (chat as Partial<typeof chat> & { addToolApprovalResponse?: unknown })
        .addToolApprovalResponse
    }
  })

  it('only offers Approve all on the last message, which the SDK answers', () => {
    chat.messages = [
      { ...turnWith([gated('c1', 'DS-7'), gated('c2', 'DS-8')]), id: 'old' },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Never mind' }] },
    ]
    const wrapper = mount(ChatMessageList)
    expect(wrapper.find('[data-testid="approval-group-header"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="approval-approve-all"]').exists()).toBe(false)
  })

  it('counts a lowercase or padded key’s points, as the api would find the issue', () => {
    chat.messages = [turnWith([gated('c1', 'ds-7'), gated('c2', '  DS-8 ')])]
    const wrapper = mount(ChatMessageList)

    expect(wrapper.get('[data-testid="approval-group-count"]').text()).toBe(
      `2 changes to review · ${points('DS-7') + points('DS-8')} pts`,
    )
    expect(wrapper.find('[data-testid="approval-warning"]').exists()).toBe(false)
  })

  it('needs no header for a single card, which keeps its Ink Approve', () => {
    chat.messages = [turnWith([gated('c1', 'DS-7')])]
    const wrapper = mount(ChatMessageList)

    expect(wrapper.find('[data-testid="approval-group-header"]').exists()).toBe(false)
    expect(ink(wrapper)).toEqual([true])
  })

  it('drops the header once every card in the group is decided', () => {
    chat.messages = [
      turnWith([
        gated('c1', 'DS-7', 'approval-responded', true),
        gated('c2', 'DS-8', 'approval-responded', false),
      ]),
    ]
    const wrapper = mount(ChatMessageList)
    expect(wrapper.find('[data-testid="approval-group-header"]').exists()).toBe(false)
  })

  describe('the empty transcript', () => {
    beforeEach(() => {
      chat.messages = []
      chat.status = 'ready'
      sendMessage.mockClear()
    })

    it('offers the chat scenarios as a labelled group of buttons', () => {
      const wrapper = mount(ChatMessageList)
      const group = wrapper.get('[data-testid="chat-suggestions"]')

      expect(group.attributes('role')).toBe('group')
      expect(group.attributes('aria-label')).toBe('Suggested requests')
      const chips = group.findAll('button')
      expect(chips.map((chip) => chip.text())).toEqual([
        'Is the sprint on track?',
        'Draft release notes',
        'Close out the sprint',
        'Deploy to staging',
        'Mark DS-42 as done',
      ])
      // Within the four-to-six a first look can take in.
      expect(chips.length).toBeLessThanOrEqual(6)
      // What will be sent is one hover away.
      expect(chips[0]?.attributes('title')).toBe('Is Sprint 12 on track? Show me the burndown.')
    })

    it('sends a suggestion’s prompt verbatim and hands focus to the composer', async () => {
      const composer = document.createElement('input')
      composer.setAttribute('data-chat-composer', '')
      const pane = document.createElement('section')
      pane.setAttribute('data-testid', 'chat-pane')
      const host = document.createElement('div')
      pane.append(host, composer)
      document.body.append(pane)
      const wrapper = mount(ChatMessageList, { attachTo: host })

      await wrapper.get('[data-scenario="S-B"]').trigger('click')

      expect(sendMessage).toHaveBeenCalledWith({
        text: "We're closing Sprint 12 today — mark every remaining open issue in the sprint as done.",
      })
      expect(document.activeElement).toBe(composer)
      wrapper.unmount()
      pane.remove()
    })

    it('goes once the conversation starts', async () => {
      const wrapper = mount(ChatMessageList)
      chat.messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }]
      await nextTick()

      expect(wrapper.find('[data-testid="chat-empty"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="chat-suggestions"]').exists()).toBe(false)
    })

    it('says the board is shared and when it resets', () => {
      const wrapper = mount(ChatMessageList)
      expect(wrapper.get('[data-testid="chat-empty"]').text()).toContain(
        'Every visitor shares this board. It resets at 00:00 UTC.',
      )
    })

    it('names the MCP endpoint and copies it, saying so', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
      const wrapper = mount(ChatMessageList)
      const line = wrapper.get('[data-testid="mcp-endpoint"]')
      expect(line.get('code').text()).toBe(MCP_URL)
      // Copy sits on the sentence's line, not after an address that fills the column.
      expect(line.get('p').find('code').exists()).toBe(false)
      expect(line.get('p').find('[data-testid="mcp-endpoint-copy"]').exists()).toBe(true)

      const copy = wrapper.get('[data-testid="mcp-endpoint-copy"]')
      expect(copy.attributes('aria-label')).toBe('Copy MCP address')
      await copy.trigger('click')
      await flushPromises()

      expect(writeText).toHaveBeenCalledWith(MCP_URL)
      expect(copy.text()).toBe('Copied')
      // Said once, by the status line; the button's name holds still.
      expect(copy.attributes('aria-label')).toBe('Copy MCP address')
      expect(wrapper.get('[data-testid="chat-status"]').text()).toBe('MCP address copied.')
      vi.unstubAllGlobals()
    })

    it('says so when the clipboard refuses', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'))
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
      const wrapper = mount(ChatMessageList)
      const copy = wrapper.get('[data-testid="mcp-endpoint-copy"]')
      await copy.trigger('click')
      await flushPromises()

      expect(copy.text()).toBe('Copy')
      expect(toastError).toHaveBeenCalledWith("Couldn't copy the address", {
        description: 'Select it and copy it by hand.',
      })
      vi.unstubAllGlobals()
    })
  })

  it('gives the user’s bubble its own fill token, not the inverted primary', () => {
    chat.messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }]
    chat.status = 'ready'
    const wrapper = mount(ChatMessageList)
    const bubble = wrapper.get('[data-role="user"]')

    expect(bubble.classes()).toContain('bg-bubble-user')
    expect(bubble.classes()).not.toContain('bg-primary')
  })
})
