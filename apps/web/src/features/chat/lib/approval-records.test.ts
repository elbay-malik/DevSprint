import { beforeEach, describe, expect, it } from 'vitest'
import {
  approvalRecord,
  clearApprovalRecords,
  decisionTimeOf,
  formatDecisionTime,
  recordDecision,
} from './approval-records'

describe('approval records', () => {
  beforeEach(() => {
    clearApprovalRecords()
  })

  it('keeps a decision by its approval id', () => {
    const decidedAt = new Date(2026, 9, 25, 14, 2)
    recordDecision('approval-1', { decidedAt, from: 'in_progress' })

    expect(approvalRecord('approval-1')).toEqual({ decidedAt, from: 'in_progress' })
    expect(approvalRecord('approval-2')).toBeUndefined()
    expect(approvalRecord(undefined)).toBeUndefined()
  })

  it('formats the time to the minute on a 24-hour clock, in any locale', () => {
    // An afternoon decision, so a 12-hour locale would show "02:02 PM".
    const decidedAt = new Date(2026, 9, 25, 14, 2, 59)
    expect(formatDecisionTime(decidedAt, 'en-GB')).toBe('14:02')
    expect(formatDecisionTime(decidedAt, 'en-US')).toBe('14:02')
    expect(formatDecisionTime(decidedAt, 'de-DE')).toBe('14:02')
    expect(formatDecisionTime(new Date(2026, 9, 25, 9, 5), 'en-US')).toBe('09:05')
  })

  it('has no time for a part this session never saw decided', () => {
    expect(decisionTimeOf({ approval: { id: 'approval-1' } })).toBeUndefined()
    expect(decisionTimeOf({})).toBeUndefined()

    recordDecision('approval-1', { decidedAt: new Date(2026, 9, 25, 14, 2) })
    expect(decisionTimeOf({ approval: { id: 'approval-1' } })).toMatch(/^14.02$/)
  })
})
