import { reactive, shallowRef } from 'vue'
import type { IssueStatus } from '@devsprint/shared'
import type { CopyPart } from './approvals'

/**
 * What the board looked like, and when, at the moment a person answered an
 * approval card. The SDK's part keeps only the decision, and the card is
 * remounted each time its state changes, so a ref on the card would be gone by
 * the time the write lands. Kept here, by approval id, for the whole session.
 */
export interface ApprovalRecord {
  /** The issue's status when the decision was made; the board moves on after. */
  from?: IssueStatus
  /**
   * Who held the issue when an assignment was decided, for the same reason;
   * null when nobody did. Absent when the card is not an assignment, or the
   * board did not hold the issue.
   */
  fromAssignee?: string | null
  decidedAt: Date
}

const records = reactive(new Map<string, ApprovalRecord>())

export function recordDecision(approvalId: string, record: ApprovalRecord): void {
  records.set(approvalId, record)
}

export function approvalRecord(approvalId: string | undefined): ApprovalRecord | undefined {
  return approvalId === undefined ? undefined : records.get(approvalId)
}

/**
 * How an Undo on an applied card went, kept by approval id for the same reason
 * as the decision: the record line has to survive the card being remounted.
 * `undone` reads "Undone by you at 14:05 — DS-9 back to In progress." (or
 * "— DS-12 back to @ben." for an assignment);
 * `refused` is the board's plain reason, and the Undo does not come back.
 */
export type UndoRecord =
  { state: 'undone'; copy: readonly CopyPart[] } | { state: 'refused'; copy: readonly CopyPart[] }

const undos = reactive(new Map<string, UndoRecord>())

/**
 * The latest undo, for the transcript's status line to say. A counter rides
 * along so two undos that read alike are still two announcements.
 */
export const lastUndo = shallowRef<{ line: string; seq: number }>()

export function recordUndo(approvalId: string, record: UndoRecord, line: string): void {
  undos.set(approvalId, record)
  lastUndo.value = { line, seq: (lastUndo.value?.seq ?? 0) + 1 }
}

export function undoRecordOf(approvalId: string | undefined): UndoRecord | undefined {
  return approvalId === undefined ? undefined : undos.get(approvalId)
}

/** For tests: every card in a spec answers the same approval id. */
export function clearApprovalRecords(): void {
  records.clear()
  undos.clear()
  lastUndo.value = undefined
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
