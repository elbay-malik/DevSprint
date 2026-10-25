import type { ToolResult } from '@devsprint/shared'
import type { UndoableToolName, UndoChangeData } from '@devsprint/shared/tools'
import { WORKSPACE_UNDO_ENDPOINT } from '@/lib/api'
import { assigneeLabel } from '@/features/workspace/lib/people'
import { statusLabel } from '@/features/workspace/lib/status-labels'
import type { CopyPart } from './approvals'

/**
 * The writes a card may offer to undo, as the api's own list has them. Kept
 * here as a typed copy rather than imported, because `@devsprint/shared/tools`
 * is a type-only import in the SPA (its schemas pull in zod).
 */
const UNDOABLE_TOOLS = [
  'create_issue',
  'update_issue_status',
  'assign_issue',
] as const satisfies readonly UndoableToolName[]

/** The fields of a settled tool part an undo is read from. */
interface UndoPartLike {
  type?: string
  toolName?: string
  state?: string
  approval?: { approved?: boolean }
  output?: unknown
}

/** What an Undo needs: the id the write's result carried, and the issue it names. */
export interface UndoTarget {
  changeId: string
  issueKey: string
}

/**
 * The applied write a card may offer to undo, or undefined. Only an approved
 * write that landed and carried a `changeId` qualifies: the id is the
 * workspace's, minted as the write landed, and it is all the undo route takes.
 */
export function undoTargetOf(part: UndoPartLike): UndoTarget | undefined {
  const tool = part.type === 'dynamic-tool' ? part.toolName : part.type?.replace(/^tool-/, '')
  if (!(UNDOABLE_TOOLS as readonly string[]).includes(tool ?? '')) return undefined
  if (part.approval?.approved !== true || part.state !== 'output-available') return undefined
  const output = part.output as
    { ok?: unknown; data?: { changeId?: unknown; issue?: { key?: unknown } } } | undefined
  const changeId = output?.ok === true ? output.data?.changeId : undefined
  const issueKey = output?.data?.issue?.key
  if (typeof changeId !== 'string' || typeof issueKey !== 'string') return undefined
  return { changeId, issueKey }
}

/**
 * Asks the workspace to reverse one write. A typed refusal comes back as its
 * envelope, as a tool's would; only a network failure or a reply that is not
 * an envelope throws, since then nothing is known about the board.
 */
export async function requestUndo(changeId: string): Promise<ToolResult<UndoChangeData>> {
  const res = await fetch(WORKSPACE_UNDO_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changeId }),
  })
  const body = (await res.json().catch(() => undefined)) as ToolResult<UndoChangeData> | undefined
  if (typeof body !== 'object' || body === null || typeof body.ok !== 'boolean') {
    throw new Error(`undo answered ${res.status}`)
  }
  return body
}

/**
 * "Undone by you at 14:05 — DS-9 back to In progress.", the key apart for mono.
 * An assignment says who holds the issue again, by @handle as the board does,
 * or "back to unassigned"; `users` is the roster that maps the id.
 */
export function undoneCopy(
  data: UndoChangeData,
  at?: string,
  users: readonly { id: string; handle: string }[] = [],
): CopyPart[] {
  const when = at === undefined ? '' : ` at ${at}`
  const lead = `Undone by you${when} — `
  if (data.outcome === 'removed' || data.issue === null) {
    return [lead, { id: data.issueKey }, ' removed from the board.']
  }
  if (data.tool === 'assign_issue') {
    const { assigneeId } = data.issue
    const who = assigneeId === null ? 'unassigned' : assigneeLabel(users, assigneeId)
    return [lead, { id: data.issueKey }, ` back to ${who}.`]
  }
  return [lead, { id: data.issueKey }, ` back to ${statusLabel(data.issue.status)}.`]
}
