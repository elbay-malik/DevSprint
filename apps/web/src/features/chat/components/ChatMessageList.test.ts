import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
