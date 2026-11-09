import { beforeEach, describe, expect, it, vi } from 'vitest'

/** guide.ts reads storage once at import, so each test imports it fresh. */
async function loadGuide() {
  vi.resetModules()
  return import('./guide')
}

describe('guide', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('shows on a first visit', async () => {
    const { guideOpen } = await loadGuide()
    expect(guideOpen.value).toBe(true)
  })

  it('closes for this visit only', async () => {
    const guide = await loadGuide()
    guide.closeGuide()
    expect(guide.guideOpen.value).toBe(false)
    expect((await loadGuide()).guideOpen.value).toBe(true)
  })

  it('stays closed on later visits once dismissed', async () => {
    const guide = await loadGuide()
    guide.dismissGuide()
    expect(guide.guideOpen.value).toBe(false)
    expect(localStorage.getItem(guide.GUIDE_STORAGE_KEY)).toBe('dismissed')
    expect((await loadGuide()).guideOpen.value).toBe(false)
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
    expect(guide.guideOpen.value).toBe(true)
    expect(() => guide.dismissGuide()).not.toThrow()
    expect(guide.guideOpen.value).toBe(false)
  })
})
