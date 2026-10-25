import { reactive } from 'vue'
import type { IssueStatus } from '@devsprint/shared'

/**
 * What the board looked like, and when, at the moment a person answered an
 * approval card. The SDK's part keeps only the decision, and the card is
 * remounted each time its state changes, so a ref on the card would be gone by
 * the time the write lands. Kept here, by approval id, for the whole session.
 */
export interface ApprovalRecord {
  /** The issue's status when the decision was made; the board moves on after. */
  from?: IssueStatus
  decidedAt: Date
}

const records = reactive(new Map<string, ApprovalRecord>())

export function recordDecision(approvalId: string, record: ApprovalRecord): void {
  records.set(approvalId, record)
}

export function approvalRecord(approvalId: string | undefined): ApprovalRecord | undefined {
  return approvalId === undefined ? undefined : records.get(approvalId)
}

/** For tests: every card in a spec answers the same approval id. */
export function clearApprovalRecords(): void {
  records.clear()
}

/**
 * "14:02": the reader's own locale, always on a 24-hour clock, to the minute.
 * A record needs the time it was decided, not the seconds or the date: the
 * transcript is one session long.
 */
export function formatDecisionTime(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

/** The formatted time a part was decided at, if this session saw the decision. */
export function decisionTimeOf(part: { approval?: { id?: string } }): string | undefined {
  const record = approvalRecord(part.approval?.id)
  return record === undefined ? undefined : formatDecisionTime(record.decidedAt)
}
