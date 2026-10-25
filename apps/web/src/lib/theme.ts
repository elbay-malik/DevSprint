import { ref, watchEffect } from 'vue'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'devsprint-theme'

/**
 * Tailwind is configured with `@custom-variant dark (&:is(.dark *))`, so every
 * `dark:` utility in the app — and the whole `.dark` token block in main.css —
 * only applies under a `.dark` ancestor. Nothing set that class, which made a
 * fully written dark palette unreachable. This is the piece that was missing.
 *
 * `system` is the default and follows the OS, which is what someone opening a
 * link at night expects; an explicit choice overrides it and is remembered.
 */
const stored = readStored()
export const theme = ref<Theme>(stored ?? 'system')

function readStored(): Theme | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : undefined
  } catch {
    // Private mode, or storage disabled. A remembered preference is a
    // convenience, not something the UI should depend on.
    return undefined
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * The OS preference, as a ref. `matchMedia().matches` is not reactive, so a
 * computed that read it directly — the header's "System (light)" label — kept
 * announcing the old theme after the OS switched. installTheme's listener
 * writes here, and everything resolved from `system` follows.
 */
const systemDark = ref(globalThis.matchMedia?.(DARK_QUERY).matches === true)

export function resolvedTheme(value: Theme): 'light' | 'dark' {
  return value === 'system' ? (systemDark.value ? 'dark' : 'light') : value
}

/**
 * The page background per theme, for the browser chrome (the mobile address
 * bar, a PWA title bar). oklch(1 0 0) and oklch(0.145 0 0) as hex, because not
 * every browser reads oklch here. index.html's pre-paint script repeats them.
 */
const THEME_COLOR = { light: '#ffffff', dark: '#0a0a0a' } as const

/** Cycles light → dark → system, so the OS default stays reachable. */
export function nextTheme(value: Theme): Theme {
  return value === 'light' ? 'dark' : value === 'dark' ? 'system' : 'light'
}

export function setTheme(value: Theme): void {
  theme.value = value
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // See readStored: not worth failing the interaction over.
  }
}

/**
 * Applies the class and the browser chrome colour, and keeps following the OS
 * while the choice is `system`. Called once from main.ts; the effect re-runs
 * whenever the choice or the OS preference changes.
 */
export function installTheme(): void {
  watchEffect(() => {
    const resolved = resolvedTheme(theme.value)
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    // Both media-keyed metas get the chosen colour: left alone, they follow
    // the OS, so picking Dark on a light OS put a white bar over a dark page.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', THEME_COLOR[resolved])
    }
  })
  globalThis.matchMedia?.(DARK_QUERY).addEventListener('change', (event) => {
    systemDark.value = event.matches
  })
}
