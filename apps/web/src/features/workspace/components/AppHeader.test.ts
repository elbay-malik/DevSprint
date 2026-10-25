import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppHeader from './AppHeader.vue'
import { setTheme, theme } from '@/lib/theme'

describe('AppHeader', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    setTheme('light')
  })

  it('offers the Reset demo control the docs have always claimed exists', async () => {
    // apps/api/README.md and ADR-0014 both justify leaving the reset route
    // ungated *because* it backs a button in the live demo's header. There was
    // no button, so that argument rested on something unbuilt — and a visitor
    // who wanted the board back had no way to ask for it.
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(AppHeader, { attachTo: document.body })
    await wrapper.get('[data-testid="reset-demo"]').trigger('click')
    // The board is shared: one click only asks.
    expect(fetchMock).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="reset-demo-confirm"]').trigger('click')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/workspace/reset')
    expect(init.method).toBe('POST')
    wrapper.unmount()
  })

  describe('the reset question', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
      vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
      vi.useRealTimers()
      document.body.innerHTML = ''
    })

    async function ask() {
      const wrapper = mount(AppHeader, { attachTo: document.body })
      await wrapper.get('[data-testid="reset-demo"]').trigger('click')
      await flushPromises()
      return wrapper
    }

    it('says what it would do, before and while it asks', async () => {
      const wrapper = mount(AppHeader, { attachTo: document.body })
      const button = wrapper.get('[data-testid="reset-demo"]')
      // The title and the description are one sentence, full stop and all.
      expect(button.attributes('title')).toBe('Restores the seed board for every visitor.')
      const hint = document.getElementById(button.attributes('aria-describedby')!)
      expect(hint?.textContent).toBe('Restores the seed board for every visitor.')

      await button.trigger('click')
      await flushPromises()
      const question = wrapper.get('[data-testid="reset-demo-question"]')
      expect(question.attributes('role')).toBe('group')
      expect(document.getElementById(question.attributes('aria-labelledby')!)?.textContent).toBe(
        'Reset for everyone?',
      )
      expect(wrapper.get('[data-testid="reset-demo-confirm"]').attributes('aria-describedby')).toBe(
        'reset-demo-hint',
      )
      wrapper.unmount()
    })

    it('moves focus to Confirm, so Enter answers it', async () => {
      const wrapper = await ask()
      expect(document.activeElement).toBe(wrapper.get('[data-testid="reset-demo-confirm"]').element)
      wrapper.unmount()
    })

    it('backs out on Esc and hands focus back to Reset board', async () => {
      const wrapper = await ask()
      await wrapper.get('[data-testid="reset-demo-question"]').trigger('keydown', { key: 'Escape' })
      await flushPromises()

      expect(wrapper.find('[data-testid="reset-demo-question"]').exists()).toBe(false)
      expect(document.activeElement).toBe(wrapper.get('[data-testid="reset-demo"]').element)
      expect(fetchMock).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('backs out on Cancel', async () => {
      const wrapper = await ask()
      await wrapper.get('[data-testid="reset-demo-cancel"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="reset-demo"]').text()).toBe('Reset board')
      expect(fetchMock).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('backs out when focus leaves the question', async () => {
      const wrapper = await ask()
      const outside = wrapper.get('[data-testid="theme-toggle"]').element
      wrapper
        .get('[data-testid="reset-demo-confirm"]')
        .element.dispatchEvent(
          new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }),
        )
      await flushPromises()
      expect(wrapper.find('[data-testid="reset-demo-question"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('backs out on a press anywhere else on the page', async () => {
      const wrapper = await ask()
      // Not a focus change: Safari moves no focus on a click, so a press is
      // what says the reader went elsewhere.
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      await flushPromises()
      expect(wrapper.find('[data-testid="reset-demo-question"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('stays for a press on Confirm, even with focus on nothing', async () => {
      const wrapper = await ask()
      const confirm = wrapper.get('[data-testid="reset-demo-confirm"]').element
      confirm.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      confirm.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      await flushPromises()
      expect(wrapper.find('[data-testid="reset-demo-question"]').exists()).toBe(true)
      await wrapper.get('[data-testid="reset-demo-confirm"]').trigger('click')
      expect(fetchMock).toHaveBeenCalled()
      wrapper.unmount()
    })

    it('stays while focus moves between Confirm and Cancel', async () => {
      const wrapper = await ask()
      const cancel = wrapper.get('[data-testid="reset-demo-cancel"]').element
      wrapper
        .get('[data-testid="reset-demo-confirm"]')
        .element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: cancel }))
      await flushPromises()
      expect(wrapper.find('[data-testid="reset-demo-question"]').exists()).toBe(true)
      wrapper.unmount()
    })

    it('waits for an answer as long as it takes', async () => {
      // It used to back out after 4s, even with focus on Confirm, which is
      // about how long a screen reader takes to read Confirm and its
      // description (WCAG 2.2.1).
      vi.useFakeTimers()
      const wrapper = await ask()
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(wrapper.find('[data-testid="reset-demo-question"]').exists()).toBe(true)
      expect(document.activeElement?.getAttribute('data-testid')).toBe('reset-demo-confirm')
      expect(fetchMock).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })

  it('takes a phone reader down to the composer', async () => {
    // Below lg the copilot sits under the whole board; from lg up the control
    // is hidden, since both panes share the view.
    const pane = document.createElement('section')
    pane.dataset.testid = 'chat-pane'
    const composer = document.createElement('input')
    composer.setAttribute('data-chat-composer', '')
    pane.append(composer)
    document.body.append(pane)

    const wrapper = mount(AppHeader, { attachTo: document.body })
    const jump = wrapper.get('[data-testid="jump-to-copilot"]')
    expect(jump.classes()).toContain('lg:hidden')
    expect(jump.text()).toContain('Copilot')
    await jump.trigger('click')

    expect(document.activeElement).toBe(composer)
    wrapper.unmount()
    pane.remove()
  })

  it('cycles the theme and keeps the OS default reachable', async () => {
    const wrapper = mount(AppHeader)
    const toggle = wrapper.get('[data-testid="theme-toggle"]')

    await toggle.trigger('click')
    expect(theme.value).toBe('dark')
    await toggle.trigger('click')
    // Not light: cycling past dark returns to following the OS, which is the
    // only way back to "I did not choose" once a choice has been made.
    expect(theme.value).toBe('system')
    await toggle.trigger('click')
    expect(theme.value).toBe('light')
  })

  it('names the current theme for assistive tech, not just a glyph', () => {
    const wrapper = mount(AppHeader)
    expect(wrapper.get('[data-testid="theme-toggle"]').attributes('aria-label')).toContain('Light')
  })
})
