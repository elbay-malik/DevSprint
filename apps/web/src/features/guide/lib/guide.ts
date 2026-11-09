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

/** Whether the first-visit card is on screen. Starts open unless dismissed before. */
export const guideOpen = ref(!dismissedBefore())

export function openGuide(): void {
  guideOpen.value = true
}

/** Close: hidden for this visit only. */
export function closeGuide(): void {
  guideOpen.value = false
}

/** Don't show again: hidden now and on later visits. */
export function dismissGuide(): void {
  guideOpen.value = false
  try {
    localStorage.setItem(GUIDE_STORAGE_KEY, 'dismissed')
  } catch {
    // See dismissedBefore: not worth failing the click over.
  }
}
