import type { ToolErrorCode } from '@devsprint/shared'

/**
 * A line of error copy, in pieces: plain words, and the identifiers inside
 * them ("DS-42", "sprint-99", "v1.4.2"), which the card sets in mono like every
 * other identifier (DESIGN.md, the Readout Rule).
 */
export type ErrorCopy = readonly (string | { id: string })[]

/** The copy as one string, for a title, a test or anything that cannot style a part. */
export function errorCopyText(copy: ErrorCopy): string {
  return copy.map((part) => (typeof part === 'string' ? part : part.id)).join('')
}

/**
 * What a failed tool call means, in the board's words, per error code
 * (docs/domain-model.md §4). The api's own message is written for the model:
 * it names the next tool to call ("search_issues") and lists ids for it to pick
 * from, which reads as a debug console to the person in the chat. The code
 * stays on the card as its label, so nothing is hidden from whoever is debugging.
 * The identifiers come back as their own parts, so the card can set them in mono.
 */
export function toolErrorCopy(toolName: string, code: string, input?: unknown): ErrorCopy {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const text = (name: string): string | undefined => {
    const value = args[name]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
  }

  switch (code as ToolErrorCode) {
    case 'ISSUE_NOT_FOUND': {
      const key = text('issueKey')
      return key
        ? ['No issue ', { id: key.toUpperCase() }, ' on the board.']
        : ['That issue isn’t on the board.']
    }
    case 'SPRINT_NOT_FOUND': {
      const sprint = text('sprintId')
      return sprint
        ? ['No sprint with the id ', { id: sprint }, '.']
        : ['There is no active sprint.']
    }
    case 'USER_NOT_FOUND': {
      const user = text('assigneeId')
      return user
        ? ['No one on the team has the id ', { id: user }, '.']
        : ['No one on the team matches that.']
    }
    case 'VERSION_EXISTS': {
      const given = text('version')
      const version = given === undefined ? 'That version' : { id: given }
      const environment = text('environment')
      if (toolName === 'run_deployment') {
        return environment
          ? [version, ' is already live in ', { id: environment }, '.']
          : [version, ' is already live.']
      }
      return given === undefined
        ? ['Release notes for that version already exist.']
        : ['Release notes for ', version, ' already exist.']
    }
    case 'DEPLOY_IN_PROGRESS': {
      const environment = text('environment')
      return environment
        ? ['A deployment to ', { id: environment }, ' is already running.']
        : ['A deployment is already running.']
    }
    case 'DEPLOY_ALREADY_SETTLED':
      return ['That deployment had already finished.']
    case 'STAGE_FAILED':
      return ['A deployment stage failed.']
    case 'WORKSPACE_FULL':
      return ['The board is full. Reset it to carry on.']
    // An undo the board refused: the issue has moved on, it was already
    // undone, or a reset cleared the record. One sentence covers all three,
    // because to the person they mean the same thing.
    case 'UNDO_CONFLICT': {
      const key = text('issueKey')
      return key
        ? [
            'That change to ',
            { id: key.toUpperCase() },
            ' can’t be undone: the board has moved on.',
          ]
        : ['That change can’t be undone: the board has moved on.']
    }
    case 'INVALID_INPUT': {
      // The one refusal an assignment has of its own (the api's assignIssue):
      // the issue already has that assignee, so there was nothing to change.
      const key = text('issueKey')
      if (toolName === 'assign_issue') {
        return key
          ? [{ id: key.toUpperCase() }, ' already has that assignee.']
          : ['That issue already has that assignee.']
      }
      return ['The board couldn’t accept that request.']
    }
    default:
      return ['That didn’t go through.']
  }
}
