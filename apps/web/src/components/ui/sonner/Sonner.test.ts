import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { Toaster } from '.'
import { setTheme } from '@/lib/theme'

describe('Toaster', () => {
  beforeEach(() => {
    setTheme('light')
  })

  it("follows the app's theme rather than sonner's light default", async () => {
    // Pinned to 'light', sonner's own dark rules (description, close button)
    // never applied, and its light description grey sat on the dark popover.
    const wrapper = mount(Toaster, { attachTo: document.body })
    const toaster = () => document.querySelector('[data-sonner-toaster]')
    expect(toaster()?.getAttribute('data-sonner-theme')).toBe('light')

    setTheme('dark')
    await nextTick()
    await nextTick()
    expect(toaster()?.getAttribute('data-sonner-theme')).toBe('dark')
    wrapper.unmount()
  })
})
