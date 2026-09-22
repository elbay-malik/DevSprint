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

function prefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

export function resolvedTheme(value: Theme): 'light' | 'dark' {
  return value === 'system' ? (prefersDark() ? 'dark' : 'light') : value
}

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
 * Applies the class and keeps following the OS while the choice is `system`.
 * Called once from main.ts; the effect re-runs whenever the ref changes.
 */
export function installTheme(): void {
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
  const apply = () => {
    document.documentElement.classList.toggle('dark', resolvedTheme(theme.value) === 'dark')
  }
  watchEffect(apply)
  media?.addEventListener('change', () => {
    if (theme.value === 'system') apply()
  })
}
