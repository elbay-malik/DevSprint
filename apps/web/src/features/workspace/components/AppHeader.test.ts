import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

    const wrapper = mount(AppHeader)
    await wrapper.get('[data-testid="reset-demo"]').trigger('click')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/workspace/reset')
    expect(init.method).toBe('POST')
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
