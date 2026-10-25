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
    // Sending now would orphan every open card: Enter still submits the form.
    chat.messages = awaiting(2)
    const wrapper = mount(ChatInput)
    await wrapper.get('[data-testid="chat-input"]').setValue('Ship it')
    await wrapper.get('[data-testid="chat-input"]').trigger('keydown', { key: 'Enter' })
    await wrapper.get('form').trigger('submit')

    expect(sendMessage).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="chat-send"]').attributes('disabled')).toBeDefined()
  })

  it('takes a draft while approvals are open, and keeps it through the unlock', async () => {
    chat.messages = awaiting(2)
    const wrapper = mount(ChatInput, { attachTo: document.body })
    const input = wrapper.get('[data-testid="chat-input"]')
    ;(input.element as HTMLInputElement).focus()

    // Editable, not read-only: only sending waits for the cards.
    expect(input.attributes('readonly')).toBeUndefined()
    expect(input.attributes('aria-disabled')).toBeUndefined()
    expect(input.attributes('aria-describedby')).toBe('composer-locked-hint')
    await input.setValue('Then deploy to staging')
    // The placeholder is hidden by the draft, so the reason becomes visible.
    expect(wrapper.get('#composer-locked-hint').classes()).not.toContain('sr-only')

    // The cards are answered: the resumed turn runs, then settles.
    chat.messages = []
    chat.status = 'submitted'
    await nextTick()
    expect(input.attributes('readonly')).toBeDefined()
    chat.status = 'ready'
    await nextTick()

    expect((input.element as HTMLInputElement).value).toBe('Then deploy to staging')
    expect(document.activeElement).toBe(input.element)
    await wrapper.get('form').trigger('submit')
    expect(sendMessage).toHaveBeenCalledWith({ text: 'Then deploy to staging' })
  })

  it('says why Send waits only to screen readers while the placeholder still shows', () => {
    chat.messages = awaiting(1)
    const wrapper = mount(ChatInput)
    expect(wrapper.get('#composer-locked-hint').classes()).toContain('sr-only')
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

  describe('prompt history', () => {
    function sent(...texts: string[]): DevSprintUIMessage[] {
      return texts.flatMap((text, index): DevSprintUIMessage[] => [
        { id: `u${index}`, role: 'user', parts: [{ type: 'text', text }] },
        { id: `a${index}`, role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] },
      ])
    }

    async function press(wrapper: ReturnType<typeof mount>, key: string) {
      await wrapper.get('[data-testid="chat-input"]').trigger('keydown', { key })
    }
    const value = (wrapper: ReturnType<typeof mount>) =>
      (wrapper.get('[data-testid="chat-input"]').element as HTMLInputElement).value

    it('recalls earlier prompts with Up from an empty field, and walks back with Down', async () => {
      chat.messages = sent('First', 'Second')
      const wrapper = mount(ChatInput)

      await press(wrapper, 'ArrowUp')
      expect(value(wrapper)).toBe('Second')
      await press(wrapper, 'ArrowUp')
      expect(value(wrapper)).toBe('First')
      // The oldest entry holds.
      await press(wrapper, 'ArrowUp')
      expect(value(wrapper)).toBe('First')
      await press(wrapper, 'ArrowDown')
      expect(value(wrapper)).toBe('Second')
      // Past the newest, back to the empty field.
      await press(wrapper, 'ArrowDown')
      expect(value(wrapper)).toBe('')
    })

    it('never replaces a draft', async () => {
      chat.messages = sent('First')
      const wrapper = mount(ChatInput)
      await wrapper.get('[data-testid="chat-input"]').setValue('My draft')

      await press(wrapper, 'ArrowUp')
      expect(value(wrapper)).toBe('My draft')
    })

    it('sends a recalled prompt as it stands', async () => {
      chat.messages = sent('How is the sprint?')
      const wrapper = mount(ChatInput)
      await press(wrapper, 'ArrowUp')
      await wrapper.get('form').trigger('submit')

      expect(sendMessage).toHaveBeenCalledWith({ text: 'How is the sprint?' })
    })

    it('recalls nothing while a turn runs, since the field is read-only', async () => {
      chat.messages = sent('First')
      chat.status = 'streaming'
      const wrapper = mount(ChatInput)

      await press(wrapper, 'ArrowUp')
      expect(value(wrapper)).toBe('')
    })
  })
})
