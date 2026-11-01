import type { ToolErrorCode } from '@devsprint/shared'
import type { ReadToolName } from '@devsprint/shared/tools'

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

/** The issue tools that only read, so asking again is safe. A typed copy, as in undo.ts. */
const ISSUE_READS = ['list_issues', 'search_issues'] as const satisfies readonly ReadToolName[]

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
    // The workspace call threw. A read can simply be asked again, but a write may
    // have landed with only its reply lost, and a second create_issue is a second
    // issue, so anything not known to be a read sends the person to the board first.
    case 'INTERNAL':
      return (ISSUE_READS as readonly string[]).includes(toolName)
        ? ['The board couldn’t be reached. Try again in a moment.']
        : [
            'The board couldn’t be reached, so this may not have saved. Check the board before trying again.',
          ]
    default:
      return ['That didn’t go through.']
  }
}

const CHAT_CONNECTION_COPY = 'Check your connection, then send your message again.'
const CHAT_GENERIC_COPY = 'Something went wrong on our side. Send your message again.'

/** Fixed copy for the api's refusals, per code. The body's own message is not for this reader. */
const CHAT_REFUSAL_COPY: Record<string, string> = {
  // A body too large, a message too long, or a transcript the api would not take.
  INVALID_INPUT: 'The copilot couldn’t read that message. Shorten it, then send it again.',
  MODEL_NOT_CONFIGURED: 'The copilot’s model isn’t available right now. The board still works.',
}

/**
 * The toast's line for a failed chat request.
 *
 * The SDK has two sources for `chat.error`, and they need opposite handling. A
 * refused request throws the raw response body as the message, so it reads as
 * JSON or an error page and gets replaced. An error inside the stream carries a
 * string the api wrote for this person (agent/errors.ts), with advice ADR-0005
 * asks for, so it has to pass through as it is.
 */
export function chatErrorDescription(error: Error): string {
  // What `fetch` throws when the request never got an answer, in every browser.
  if (error instanceof TypeError) return CHAT_CONNECTION_COPY

  const message = error.message.trim()
  if (message === '' || message === 'Internal Server Error') return CHAT_CONNECTION_COPY
  if (message.startsWith('<')) return CHAT_GENERIC_COPY
  if (!message.startsWith('{')) return error.message

  try {
    const body = JSON.parse(message) as { error?: { code?: unknown } }
    const code = body.error?.code
    return (typeof code === 'string' ? CHAT_REFUSAL_COPY[code] : undefined) ?? CHAT_GENERIC_COPY
  } catch {
    // Starts like JSON but is not, so it is not one of the api's own sentences either.
    return CHAT_GENERIC_COPY
  }
}
