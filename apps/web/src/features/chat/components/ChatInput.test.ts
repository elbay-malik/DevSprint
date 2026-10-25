import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DevSprintUIMessage } from '../types'

const sendMessage = vi.fn()
const chat = reactive({
  messages: [] as DevSprintUIMessage[],
  status: 'ready',
  error: undefined as Error | undefined,
  sendMessage,
  stop: vi.fn(),
  clearError: vi.fn(),
})

vi.mock('../composables/useDevSprintChat', () => ({
  useDevSprintChat: () => chat,
}))

const { default: ChatInput } = await import('./ChatInput.vue')

/** The last assistant turn, holding `count` open approval cards. */
function awaiting(count: number): DevSprintUIMessage[] {
  return [
    {
      id: 'a1',
      role: 'assistant',
      parts: Array.from({ length: count }, (_, index) => ({
        type: 'tool-update_issue_status',
        toolCallId: `c${index}`,
        state: 'approval-requested',
        input: { issueKey: `DS-${index}`, status: 'done' },
        approval: { id: `a${index}` },
      })),
    } as unknown as DevSprintUIMessage,
  ]
}

describe('ChatInput', () => {
  beforeEach(() => {
    chat.messages = []
    chat.status = 'ready'
    sendMessage.mockClear()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps focus in the composer when a turn starts, instead of disabling it', async () => {
    // A disabled field drops its focus to <body>, and a screen reader's place
    // in the page goes with it.
    const wrapper = mount(ChatInput, { attachTo: document.body })
    const input = wrapper.get('[data-testid="chat-input"]')
    ;(input.element as HTMLInputElement).focus()

    chat.status = 'submitted'
    await nextTick()

    expect(input.attributes('disabled')).toBeUndefined()
    expect(input.attributes('readonly')).toBeDefined()
    expect(input.attributes('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(input.element)
  })

  it('is editable again once the turn is over', async () => {
    chat.status = 'streaming'
    const wrapper = mount(ChatInput)
    chat.status = 'ready'
    await nextTick()

    const input = wrapper.get('[data-testid="chat-input"]')
    expect(input.attributes('readonly')).toBeUndefined()
    expect(input.attributes('aria-disabled')).toBeUndefined()
  })

  it('names what to do in a placeholder short enough to fit, and in full for screen readers', () => {
    chat.messages = awaiting(5)
    const wrapper = mount(ChatInput)
    const input = wrapper.get('[data-testid="chat-input"]')

    expect(input.attributes('placeholder')).toBe('Decide on the 5 changes above')
    expect(input.attributes('aria-describedby')).toBe('composer-locked-hint')
    expect(wrapper.get('#composer-locked-hint').text()).toBe(
      'Approve or deny the 5 changes above to continue.',
    )
  })

  it('uses the singular for one open change', () => {
    chat.messages = awaiting(1)
    const wrapper = mount(ChatInput)
    expect(wrapper.get('[data-testid="chat-input"]').attributes('placeholder')).toBe(
      'Decide on the change above',
    )
  })

  it('does not send while approvals are open, even if the form is submitted', async () => {
    // Sending now would orphan every open card, and read-only is not a guard on
    // its own: Enter still submits the form.
    chat.messages = awaiting(2)
    const wrapper = mount(ChatInput)
    await wrapper.get('[data-testid="chat-input"]').setValue('Ship it')
    await wrapper.get('form').trigger('submit')

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sends a typed message when the copilot is idle', async () => {
    const wrapper = mount(ChatInput)
    await wrapper.get('[data-testid="chat-input"]').setValue('  How is the sprint?  ')
    await wrapper.get('form').trigger('submit')

    expect(sendMessage).toHaveBeenCalledWith({ text: 'How is the sprint?' })
  })
  it('names what Stop stops, so it is not mistaken for a deploy’s Cancel', async () => {
    // During a deploy the card's "Cancel" sits above; this ends only the reply.
    chat.status = 'streaming'
    const wrapper = mount(ChatInput)
    const stop = wrapper.get('[data-testid="chat-stop"]')

    expect(stop.text()).toBe('Stop reply')
    expect(stop.attributes('aria-label')).toBe('Stop reply')
    await stop.trigger('click')
    expect(chat.stop).toHaveBeenCalledOnce()
  })
})
