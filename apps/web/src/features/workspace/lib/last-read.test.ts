import { describe, expect, it } from 'vitest'
import { lastReadLabel } from './last-read'

const read = Date.parse('2026-10-25T14:00:00Z')
const after = (ms: number) => read + ms

describe('lastReadLabel', () => {
  it('says "just now" for the first minute', () => {
    expect(lastReadLabel(read, read)).toBe('Updated just now')
    expect(lastReadLabel(read, after(59_999))).toBe('Updated just now')
  })

  it('counts whole minutes, then hours', () => {
    expect(lastReadLabel(read, after(60_000))).toBe('Updated 1 min ago')
    expect(lastReadLabel(read, after(2 * 60_000 + 30_000))).toBe('Updated 2 min ago')
    expect(lastReadLabel(read, after(59 * 60_000))).toBe('Updated 59 min ago')
    expect(lastReadLabel(read, after(60 * 60_000))).toBe('Updated 1 hour ago')
    expect(lastReadLabel(read, after(3 * 60 * 60_000))).toBe('Updated 3 hours ago')
  })

  it('never reads a clock that runs behind the read as the future', () => {
    expect(lastReadLabel(read, after(-5_000))).toBe('Updated just now')
  })
})
