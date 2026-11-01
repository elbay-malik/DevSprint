import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_HISTORY_MESSAGES, trimChatHistory } from '@devsprint/shared'
import type { DevSprintUIMessage } from '../types'
import { useDevSprintChat } from './useDevSprintChat'

describe('useDevSprintChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the range the api keeps, not the whole transcript', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const chat = useDevSprintChat()
    chat.messages = Array.from({ length: 300 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      parts: [{ type: 'text', text: `message ${index}` }],
    }))

    await chat.sendMessage({ text: 'the latest' })

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      id: string
      trigger: string
      messages: DevSprintUIMessage[]
    }
    expect(body.messages.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES)
    expect(body.messages[0]?.role).toBe('user')
    expect(body.messages.at(-1)?.parts).toEqual([{ type: 'text', text: 'the latest' }])
    expect(body.messages).toEqual(trimChatHistory(body.messages))
    // The rest of the default body stays as the SDK sends it.
    expect(body.id).toBe(chat.id)
    expect(body.trigger).toBe('submit-message')
    // The transcript on screen is not touched, only what goes over the wire.
    expect(chat.messages.length).toBeGreaterThan(300)
  })
})
