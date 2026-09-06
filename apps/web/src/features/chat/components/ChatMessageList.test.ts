import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { DevSprintUIMessage } from '../types'

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
