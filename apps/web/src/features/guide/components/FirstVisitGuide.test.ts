import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import FirstVisitGuide from './FirstVisitGuide.vue'
import { GUIDE_STORAGE_KEY, guideOpen, openGuide } from '../lib/guide'

/** The guide with what it hands focus to and closes on: the Guide button and a composer. */
const Page = defineComponent({
  setup: () => () =>
    h('div', [
      h('button', { 'data-testid': 'guide-open', onClick: openGuide }, 'Guide'),
      h('input', { 'data-chat-composer': '', 'aria-label': 'Message the copilot' }),
      h(FirstVisitGuide),
    ]),
})

describe('FirstVisitGuide', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    localStorage.clear()
    guideOpen.value = true
    wrapper = mount(Page, { attachTo: document.body })
  })

  afterEach(() => wrapper.unmount())

  it('names itself and lists the steps, without taking focus', () => {
    const card = wrapper.get('[data-testid="guide"]')
    expect(card.element.tagName).toBe('ASIDE')
    expect(card.attributes('aria-labelledby')).toBe('guide-title')
    expect(card.get('#guide-title').text()).toBe('Try this')
    expect(card.findAll('li')).toHaveLength(4)
    expect(card.element.contains(document.activeElement)).toBe(false)
  })

  it('closes for the visit and hands focus back to the Guide button', async () => {
    const close = wrapper.get('[data-testid="guide-close"]')
    ;(close.element as HTMLElement).focus()
    await close.trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="guide"]').exists()).toBe(false)
    expect(localStorage.getItem(GUIDE_STORAGE_KEY)).toBeNull()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="guide-open"]').element)
  })

  it('remembers Don’t show again', async () => {
    await wrapper.get('[data-testid="guide-dismiss"]').trigger('click')
    expect(wrapper.find('[data-testid="guide"]').exists()).toBe(false)
    expect(localStorage.getItem(GUIDE_STORAGE_KEY)).toBe('dismissed')
  })

  it('closes on Esc', async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.find('[data-testid="guide"]').exists()).toBe(false)
  })

  it('closes once the composer gets focus', async () => {
    ;(wrapper.get('[data-chat-composer]').element as HTMLElement).focus()
    await nextTick()
    expect(wrapper.find('[data-testid="guide"]').exists()).toBe(false)
  })

  it('reopens from the Guide button', async () => {
    await wrapper.get('[data-testid="guide-close"]').trigger('click')
    await wrapper.get('[data-testid="guide-open"]').trigger('click')
    expect(wrapper.find('[data-testid="guide"]').exists()).toBe(true)
  })
})
