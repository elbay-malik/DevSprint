import { enableAutoUnmount, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chat = reactive({
  messages: [] as { id: string; role: string; parts: unknown[] }[],
  status: 'ready',
})

vi.mock('../composables/useDevSprintChat', () => ({ useDevSprintChat: () => chat }))

/** Lets a spec fire the list's `reveal`, as a decision moving focus to a card does. */
let reveal: () => void = () => undefined

vi.mock('./ChatMessageList.vue', () => ({
  default: defineComponent({
    emits: ['reveal'],
    setup(_, { emit }) {
      reveal = () => emit('reveal')
      return () => h('div', { 'data-testid': 'list' })
    },
  }),
}))
vi.mock('./ChatInput.vue', () => ({ default: defineComponent(() => () => h('div')) }))
// reka-ui's viewport, reduced to the slot ChatPane looks for.
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: defineComponent(
    (_, { slots }) =>
      () =>
        h('div', { 'data-slot': 'scroll-area-viewport' }, [h('div', slots.default?.())]),
  ),
}))

const { default: ChatPane } = await import('./ChatPane.vue')

enableAutoUnmount(afterEach)

/** A viewport 300px tall over `height` px of transcript, scrolled where it was set. */
function fakeScroll(viewport: HTMLElement, height: () => number) {
  let top = 0
  Object.defineProperty(viewport, 'scrollHeight', { get: height, configurable: true })
  Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true })
  Object.defineProperty(viewport, 'scrollTop', {
    get: () => top,
    set: (value: number) => (top = Math.min(value, height() - 300)),
    configurable: true,
  })
  return { top: () => top }
}

async function settle() {
  await nextTick()
  await nextTick()
}

describe('ChatPane', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    chat.messages = []
    chat.status = 'ready'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows the reply to the last approval, after decisions moved the view up', async () => {
    const wrapper = mount(ChatPane)
    let height = 1000
    const viewport = wrapper.get('[data-slot="scroll-area-viewport"]').element as HTMLElement
    const scroll = fakeScroll(viewport, () => height)

    chat.messages = [{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'cards' }] }]
    chat.status = 'streaming'
    await settle()
    expect(scroll.top()).toBe(700)

    // A decision brings its card to the top: the anchor is released.
    reveal()
    viewport.scrollTop = 200
    viewport.dispatchEvent(new Event('scroll'))
    chat.status = 'ready'
    await settle()
    expect(scroll.top()).toBe(200)

    // The last card is answered and the turn resumes with the answer below.
    chat.status = 'submitted'
    await settle()
    height = 1200
    chat.status = 'streaming'
    chat.messages[0]!.parts = [{ type: 'text', text: '4 of the 5 issues are now Done.' }]
    await settle()
    expect(scroll.top()).toBe(900)
  })

  it('leaves a reader who scrolled up mid-stream where they are', async () => {
    const wrapper = mount(ChatPane)
    let height = 1000
    const viewport = wrapper.get('[data-slot="scroll-area-viewport"]').element as HTMLElement
    const scroll = fakeScroll(viewport, () => height)

    chat.messages = [{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'one' }] }]
    chat.status = 'streaming'
    await settle()
    expect(scroll.top()).toBe(700)

    viewport.scrollTop = 100
    viewport.dispatchEvent(new Event('scroll'))
    height = 1100
    chat.messages[0]!.parts = [{ type: 'text', text: 'one two' }]
    await settle()
    expect(scroll.top()).toBe(100)
  })
})
