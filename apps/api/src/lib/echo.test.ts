import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { extractLastUserText, tokenize } from './echo'

function userMessage(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

describe('extractLastUserText', () => {
  it('returns the text of the most recent user message', () => {
    const messages: UIMessage[] = [
      userMessage('m1', 'first'),
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Echo: first' }] },
      userMessage('m3', 'second'),
    ]
    expect(extractLastUserText(messages)).toBe('second')
  })

  it('ignores non-text parts', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' },
        ],
      },
    ]
    expect(extractLastUserText(messages)).toBe('hello world')
  })

  it('returns an empty string when there is no user message', () => {
    expect(extractLastUserText([])).toBe('')
  })
})

describe('tokenize', () => {
  it('preserves trailing whitespace per token', () => {
    expect(tokenize('hello streaming world')).toEqual(['hello ', 'streaming ', 'world'])
  })

  it('returns an empty array for empty input', () => {
    expect(tokenize('')).toEqual([])
  })
})
