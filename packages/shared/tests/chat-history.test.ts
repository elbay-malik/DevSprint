import { describe, expect, it } from 'vitest'
import { MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES, trimChatHistory } from '../src/index'

interface Message {
  id: string
  role: string
  text?: string
}

/** Alternating user and assistant messages, ending on the assistant. */
function exchanges(count: number, text = 'hi'): Message[] {
  return Array.from({ length: count * 2 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text,
  }))
}

const user = (id: string, text = 'hi'): Message => ({ id, role: 'user', text })
const assistant = (id: string, text = 'hi'): Message => ({ id, role: 'assistant', text })

describe('trimChatHistory', () => {
  it('leaves a short conversation alone', () => {
    const messages = exchanges(3)
    expect(trimChatHistory(messages)).toEqual(messages)
  })

  it('keeps no more than the message limit', () => {
    const trimmed = trimChatHistory([...exchanges(100), user('latest')])

    expect(trimmed.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES)
    expect(trimmed.at(-1)?.id).toBe('latest')
  })

  it('keeps no more than the character budget', () => {
    const trimmed = trimChatHistory([...exchanges(5, 'x'.repeat(10_000)), user('latest')])

    expect(JSON.stringify(trimmed).length).toBeLessThanOrEqual(MAX_HISTORY_CHARS)
    expect(trimmed.length).toBeGreaterThan(1)
  })

  it('starts what it keeps on a user message', () => {
    // Nineteen would leave an assistant message first if the count alone decided.
    const trimmed = trimChatHistory([...exchanges(50), user('latest')])

    expect(trimmed[0]?.role).toBe('user')
  })

  it('always keeps the latest user message and everything after it, over any budget', () => {
    // An approval resume ends on the assistant, and the question it answers has
    // to stay with it however large the two are.
    const question = user('question', 'x'.repeat(MAX_HISTORY_CHARS))
    const resume = assistant('resume', 'y'.repeat(MAX_HISTORY_CHARS))
    const step = assistant('step')

    expect(trimChatHistory([...exchanges(5), question, resume, step])).toEqual([
      question,
      resume,
      step,
    ])
  })

  it('always keeps a turn longer than the message limit', () => {
    const turn = Array.from({ length: MAX_HISTORY_MESSAGES + 5 }, (_, index) =>
      assistant(`a${index}`),
    )
    expect(trimChatHistory([user('old'), assistant('a'), user('latest'), ...turn])).toEqual([
      user('latest'),
      ...turn,
    ])
  })

  it('never opens on the assistant when there is no earlier user message in range', () => {
    const messages = [assistant('stray'), user('latest')]
    expect(trimChatHistory(messages)).toEqual([user('latest')])
  })

  it('leaves a transcript with no user message alone', () => {
    const messages = [assistant('a'), assistant('b')]
    expect(trimChatHistory(messages)).toEqual(messages)
  })
})
