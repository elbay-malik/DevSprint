import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** guide.ts keeps per-visit state, so each test imports it fresh. */
async function loadGuide() {
  vi.resetModules()
  return import('./guide')
}

/** A document.fonts whose `ready` the test resolves. */
function fakeFonts() {
  let resolve: () => void = () => undefined
  const ready = new Promise<void>((done) => {
    resolve = done
  })
  Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true })
  return { loaded: () => resolve() }
}

describe('guide', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts')
    vi.useRealTimers()
  })

  it('shows on a first visit once the web fonts have loaded', async () => {
    const fonts = fakeFonts()
    const guide = await loadGuide()
    const shown = guide.showOnLoad()
    await Promise.resolve()
    expect(guide.guideOpen.value).toBe(false)
    fonts.loaded()
    await shown
    expect(guide.guideOpen.value).toBe(true)
  })

  it('shows anyway if the fonts take too long', async () => {
    vi.useFakeTimers()
    fakeFonts()
    const guide = await loadGuide()
    const shown = guide.showOnLoad()
    await vi.advanceTimersByTimeAsync(guide.SHOW_TIMEOUT_MS)
    await shown
    expect(guide.guideOpen.value).toBe(true)
  })

  it('stays out of the way if closed before it showed', async () => {
    const fonts = fakeFonts()
    const guide = await loadGuide()
    const shown = guide.showOnLoad()
    guide.closeGuide()
    fonts.loaded()
    await shown
    expect(guide.guideOpen.value).toBe(false)
  })

  it('closes for this visit only', async () => {
    const guide = await loadGuide()
    await guide.showOnLoad()
    guide.closeGuide()
    expect(guide.guideOpen.value).toBe(false)
    const next = await loadGuide()
    await next.showOnLoad()
    expect(next.guideOpen.value).toBe(true)
  })

  it('stays closed on later visits once dismissed', async () => {
    const guide = await loadGuide()
    guide.dismissGuide()
    expect(localStorage.getItem(guide.GUIDE_STORAGE_KEY)).toBe('dismissed')
    const next = await loadGuide()
    await next.showOnLoad()
    expect(next.guideOpen.value).toBe(false)
  })

  it('reopens after being dismissed', async () => {
    const guide = await loadGuide()
    guide.dismissGuide()
    guide.openGuide()
    expect(guide.guideOpen.value).toBe(true)
  })

  it('still works when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const guide = await loadGuide()
    await guide.showOnLoad()
    expect(guide.guideOpen.value).toBe(true)
    expect(() => guide.dismissGuide()).not.toThrow()
    expect(guide.guideOpen.value).toBe(false)
  })
})
