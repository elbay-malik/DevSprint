import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick } from 'vue'

/**
 * A matchMedia whose answer the test controls, with the `change` event the
 * browser fires when the OS switches theme while the page is open.
 */
function fakeOsTheme(dark: boolean) {
  const listeners: ((event: { matches: boolean }) => void)[] = []
  const media = {
    get matches() {
      return dark
    },
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
      listeners.push(listener)
    },
  }
  vi.stubGlobal('matchMedia', () => media)
  return {
    switchTo(next: boolean) {
      dark = next
      for (const listener of listeners) listener({ matches: next })
    },
  }
}

/** theme.ts reads the OS once at import, so each test imports it fresh. */
async function loadTheme() {
  vi.resetModules()
  return import('./theme')
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.head.innerHTML = `
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />`
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('re-resolves System when the OS switches, so labels built on it stay true', async () => {
    // The header's "System (light)" label is a computed over resolvedTheme().
    // It read matchMedia() directly, which Vue cannot track, and kept saying
    // light after the OS went dark.
    const os = fakeOsTheme(false)
    const { installTheme, resolvedTheme } = await loadTheme()
    installTheme()
    const label = computed(() => resolvedTheme('system'))
    expect(label.value).toBe('light')

    os.switchTo(true)
    expect(label.value).toBe('dark')
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('leaves an explicit choice alone when the OS switches', async () => {
    const os = fakeOsTheme(false)
    const { installTheme, setTheme } = await loadTheme()
    setTheme('light')
    installTheme()

    os.switchTo(true)
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('tints the browser chrome with the chosen theme, not the OS preference', async () => {
    // Both metas are media-keyed to the OS, so picking Dark on a light OS left
    // a white address bar over a dark page.
    fakeOsTheme(false)
    const { installTheme, setTheme } = await loadTheme()
    installTheme()
    const colours = () =>
      [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
        meta.getAttribute('content'),
      )
    expect(colours()).toEqual(['#ffffff', '#ffffff'])

    setTheme('dark')
    await nextTick()
    expect(colours()).toEqual(['#0a0a0a', '#0a0a0a'])
  })
})
