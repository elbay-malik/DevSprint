import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RETURN_READ_MIN_MS, useReadOnReturn, type ReadOnReturnOptions } from './useReadOnReturn'

function mountWith(options: Partial<ReadOnReturnOptions> = {}) {
  const read = vi.fn()
  const host = defineComponent({
    setup() {
      useReadOnReturn({ read, blocked: () => false, lastReadAt: () => undefined, ...options })
      return () => h('div')
    },
  })
  return { read, wrapper: mount(host) }
}

const focusWindow = () => window.dispatchEvent(new Event('focus'))
const becomeVisible = () => document.dispatchEvent(new Event('visibilitychange'))

describe('useReadOnReturn', () => {
  let visibility: DocumentVisibilityState

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-25T14:00:00Z'))
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('re-reads the board when the reader comes back to the tab', () => {
    const { read } = mountWith()
    focusWindow()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reads once for a tab switch, which fires both events', () => {
    const { read } = mountWith()
    becomeVisible()
    focusWindow()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reads at most once every five seconds', () => {
    const { read } = mountWith()
    focusWindow()
    vi.advanceTimersByTime(RETURN_READ_MIN_MS - 1)
    focusWindow()
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    focusWindow()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('counts a read the board just had, such as a turn settling', () => {
    const readAt = Date.now() - 1_000
    const { read } = mountWith({ lastReadAt: () => readAt })
    focusWindow()
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(RETURN_READ_MIN_MS - 1_000)
    focusWindow()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('never reads while a chat turn is streaming', () => {
    let streaming = true
    const { read } = mountWith({ blocked: () => streaming })
    focusWindow()
    expect(read).not.toHaveBeenCalled()
    // A skipped return does not hold the next one back.
    streaming = false
    focusWindow()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the page is hidden', () => {
    const { read } = mountWith()
    visibility = 'hidden'
    becomeVisible()
    expect(read).not.toHaveBeenCalled()
  })

  it('stops listening once the board is gone', () => {
    const { read, wrapper } = mountWith()
    wrapper.unmount()
    focusWindow()
    expect(read).not.toHaveBeenCalled()
  })
})
