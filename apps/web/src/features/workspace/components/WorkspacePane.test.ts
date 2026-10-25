import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import type { DevSprintUIMessage } from '@/features/chat/types'
import { RETURN_READ_MIN_MS } from '../composables/useReadOnReturn'

const chat = reactive({ messages: [] as DevSprintUIMessage[], status: 'ready' })

vi.mock('@/features/chat/composables/useDevSprintChat', () => ({
  useDevSprintChat: () => chat,
}))

const { default: WorkspacePane } = await import('./WorkspacePane.vue')

enableAutoUnmount(afterEach)

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const focusWindow = () => window.dispatchEvent(new Event('focus'))

describe('WorkspacePane', () => {
  let fetchMock: Mock<() => Promise<Response>>

  beforeEach(() => {
    setActivePinia(createPinia())
    chat.status = 'ready'
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-25T14:00:00Z'))
    fetchMock = vi.fn(() => Promise.resolve(respond(createWorkspaceSeed())))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('names the connection, not the sprint, and says when the board was read', async () => {
    const wrapper = mount(WorkspacePane)
    await flushPromises()

    expect(wrapper.get('[data-testid="workspace-source"]').text()).toBe('Live board')
    const updated = wrapper.get('[data-testid="workspace-updated"]')
    expect(updated.element.tagName).toBe('TIME')
    expect(updated.text()).toBe('Updated just now')

    // The line keeps time on its own, every 30s, with no new read.
    vi.advanceTimersByTime(2 * 60_000)
    await flushPromises()
    expect(wrapper.get('[data-testid="workspace-updated"]').text()).toBe('Updated 2 min ago')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('says offline, with no read time, when the Worker cannot be reached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fetchMock.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')))
    const wrapper = mount(WorkspacePane)
    await flushPromises()

    expect(wrapper.get('[data-testid="workspace-source"]').text()).toBe('Offline')
    expect(wrapper.find('[data-testid="workspace-updated"]').exists()).toBe(false)
  })

  it('keeps the last board on a failed re-read, and says it is offline', async () => {
    // A laptop wakes and the tab turns visible before the network is back.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const moved = createWorkspaceSeed()
    moved.issues.find((issue) => issue.key === 'DS-7')!.status = 'done'
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(respond(moved)))
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
    const wrapper = mount(WorkspacePane)
    await flushPromises()

    vi.advanceTimersByTime(3 * 60_000)
    focusWindow()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Not the seed: DS-7 stays where the last good read had it.
    expect(wrapper.find('[data-testid="board-column-done"] [data-issue-key="DS-7"]').exists()).toBe(
      true,
    )
    expect(wrapper.get('[data-testid="workspace-source"]').text()).toBe('Offline')
    expect(wrapper.get('[data-testid="workspace-updated"]').text()).toBe('Updated 3 min ago')
  })

  it('re-reads the board when the reader comes back, and marks what moved', async () => {
    // An MCP host moved DS-7 while the tab was in the background (S-F).
    const moved = createWorkspaceSeed()
    moved.issues.find((issue) => issue.key === 'DS-7')!.status = 'done'
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(respond(createWorkspaceSeed())))
      .mockImplementationOnce(() => Promise.resolve(respond(moved)))
    const wrapper = mount(WorkspacePane)
    await flushPromises()

    // Straight after the mount's own read, a return is not a second one.
    focusWindow()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(RETURN_READ_MIN_MS)
    focusWindow()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const card = wrapper.get('[data-testid="board-column-done"] [data-issue-key="DS-7"]')
    expect(card.attributes()).toHaveProperty('data-board-change')
  })

  it('does not re-read while a chat turn is streaming', async () => {
    mount(WorkspacePane)
    await flushPromises()
    vi.advanceTimersByTime(RETURN_READ_MIN_MS)

    chat.status = 'streaming'
    focusWindow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the backlog count above the board and jumps to it', async () => {
    const wrapper = mount(WorkspacePane, { attachTo: document.body })
    await flushPromises()

    const jump = wrapper.get('[data-testid="jump-to-backlog"]')
    expect(jump.text()).toContain('Backlog')
    expect(jump.text()).toContain('Backlog, 2 issues')
    await jump.trigger('click')
    expect(document.activeElement?.id).toBe('board-backlog-heading')
  })

  it('shows the pace against the ideal line under Remaining', async () => {
    const wrapper = mount(WorkspacePane)
    await flushPromises()

    const remaining = wrapper.get('[data-testid="sprint-stat"][data-stat="Remaining"]')
    expect(remaining.get('[data-testid="stat-pace"]').text()).toBe('13 pts behind ideal')
    const daysLeft = wrapper.get('[data-testid="sprint-stat"][data-stat="Days left"]')
    expect(daysLeft.text()).toContain('4 days')
    expect(wrapper.text()).not.toContain('Progress')
  })
})
