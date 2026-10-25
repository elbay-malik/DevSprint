import { describe, expect, it } from 'vitest'
import { promptHistory, stepHistory } from './prompt-history'

const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] })
const assistant = (text: string) => ({ role: 'assistant', parts: [{ type: 'text', text }] })

describe('promptHistory', () => {
  it('keeps the user’s prompts, oldest first, trimmed', () => {
    expect(promptHistory([user(' First '), assistant('Reply'), user('Second')])).toEqual([
      'First',
      'Second',
    ])
  })

  it('keeps a prompt sent twice in a row once, and skips empty ones', () => {
    expect(promptHistory([user('Again'), user('Again'), user('  '), user('Other')])).toEqual([
      'Again',
      'Other',
    ])
  })

  it('ignores parts that are not text', () => {
    expect(
      promptHistory([{ role: 'user', parts: [{ type: 'file' }, { type: 'text', text: 'Hi' }] }]),
    ).toEqual(['Hi'])
  })
})

describe('stepHistory', () => {
  const entries = ['First', 'Second']
  const empty = { index: undefined, text: '' }

  it('starts from the newest entry on an empty field', () => {
    expect(stepHistory(entries, empty, 'older')).toEqual({ index: 1, text: 'Second' })
  })

  it('leaves Up alone when there is no history, or a draft is typed', () => {
    expect(stepHistory([], empty, 'older')).toBeUndefined()
    expect(stepHistory(entries, { index: undefined, text: 'Draft' }, 'older')).toBeUndefined()
  })

  it('stops browsing once a recalled entry is edited', () => {
    const edited = { index: 1, text: 'Second, edited' }
    expect(stepHistory(entries, edited, 'older')).toBeUndefined()
    expect(stepHistory(entries, edited, 'newer')).toBeUndefined()
  })

  it('holds at the oldest entry', () => {
    const oldest = { index: 0, text: 'First' }
    expect(stepHistory(entries, oldest, 'older')).toEqual(oldest)
  })

  it('goes forward with Down, and past the newest back to the empty field', () => {
    expect(stepHistory(entries, { index: 0, text: 'First' }, 'newer')).toEqual({
      index: 1,
      text: 'Second',
    })
    expect(stepHistory(entries, { index: 1, text: 'Second' }, 'newer')).toEqual(empty)
  })

  it('leaves Down alone outside the history', () => {
    expect(stepHistory(entries, empty, 'newer')).toBeUndefined()
  })
})
