import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const chat = reactive({ messages: [] as DevSprintUIMessage[], status: 'ready' })

vi.mock('../composables/useDevSprintChat', () => ({
  useDevSprintChat: () => chat,
}))

const { default: ChatMessageList } = await import('./ChatMessageList.vue')

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
    expect(status(wrapper)).toBe('Denied: “Blocked”. 1 change needs your approval.')
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
