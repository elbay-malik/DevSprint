import { ref } from 'vue'

/**
 * Where "Don't show again" is kept. Bump the version when the steps change, so
 * a visitor who dismissed the old card sees the new one once.
 */
export const GUIDE_STORAGE_KEY = 'guide:devsprint:v1'

function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(GUIDE_STORAGE_KEY) === 'dismissed'
  } catch {
    // Storage blocked: the card shows each visit, which is all that is lost.
    return false
  }
}

/** Whether the first-visit card is on screen. It opens on load through showOnLoad. */
export const guideOpen = ref(false)

/** Set by Close and Don't show again, so a late showOnLoad stays out of the way. */
let closedThisVisit = false

/** The longest the card waits for the web fonts before it shows anyway. */
export const SHOW_TIMEOUT_MS = 1500

/**
 * Opens the card on a first visit once the web fonts have loaded. Shown
 * earlier, its text reflowed when the font swapped in, which Lighthouse
 * counted as a layout shift on a phone. A visitor who closes it, or starts
 * typing, before then does not get it afterwards.
 */
export async function showOnLoad(): Promise<void> {
  if (dismissedBefore()) return
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  await Promise.race([
    fonts?.ready ?? Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, SHOW_TIMEOUT_MS)),
  ])
  if (closedThisVisit) return
  guideOpen.value = true
}

export function openGuide(): void {
  guideOpen.value = true
}

/** Close: hidden for this visit only. */
export function closeGuide(): void {
  closedThisVisit = true
  guideOpen.value = false
}

/** Don't show again: hidden now and on later visits. */
export function dismissGuide(): void {
  closedThisVisit = true
  guideOpen.value = false
  try {
    localStorage.setItem(GUIDE_STORAGE_KEY, 'dismissed')
  } catch {
    // See dismissedBefore: not worth failing the click over.
  }
}
