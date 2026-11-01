import { describe, expect, it } from 'vitest'
import { MAX_USER_MESSAGE_CHARS } from '@devsprint/shared'
import { chatRequestRefusal } from './request-bounds'

function user(...parts: unknown[]) {
  return { id: 'u1', role: 'user', parts }
}

const text = (value: string) => ({ type: 'text', text: value })

describe('chatRequestRefusal', () => {
  it('lets a message at the limit through', () => {
    expect(chatRequestRefusal([user(text('x'.repeat(MAX_USER_MESSAGE_CHARS)))])).toBeUndefined()
  })

  it('refuses a message over the limit, wherever it sits in the transcript', () => {
    const long = user(text('x'.repeat(MAX_USER_MESSAGE_CHARS + 1)))
    expect(chatRequestRefusal([long, user(text('short'))])).toContain('at most')
  })

  it('does not hold an assistant message to the limit', () => {
    // Model answers run longer than anything the person may type.
    const answer = {
      id: 'a1',
      role: 'assistant',
      parts: [text('x'.repeat(MAX_USER_MESSAGE_CHARS * 3))],
    }
    expect(chatRequestRefusal([user(text('hi')), answer])).toBeUndefined()
  })

  it('leaves a malformed transcript to the validator', () => {
    expect(chatRequestRefusal([null, 'x', { role: 'user' }, user(null)])).toBeUndefined()
  })
})
