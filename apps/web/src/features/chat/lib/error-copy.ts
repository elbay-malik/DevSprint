import type { ToolErrorCode } from '@devsprint/shared'

/**
 * What a failed tool call means, in the board's words, per error code
 * (docs/domain-model.md §4). The api's own message is written for the model:
 * it names the next tool to call ("search_issues") and lists ids for it to pick
 * from, which reads as a debug console to the person in the chat. The code
 * stays on the card as its label, so nothing is hidden from whoever is debugging.
 */
export function toolErrorCopy(toolName: string, code: string, input?: unknown): string {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const text = (name: string): string | undefined => {
    const value = args[name]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
  }

  switch (code as ToolErrorCode) {
    case 'ISSUE_NOT_FOUND': {
      const key = text('issueKey')
      return key ? `No issue ${key.toUpperCase()} on the board.` : 'That issue isn’t on the board.'
    }
    case 'SPRINT_NOT_FOUND': {
      const sprint = text('sprintId')
      return sprint ? `No sprint with the id ${sprint}.` : 'There is no active sprint.'
    }
    case 'USER_NOT_FOUND': {
      const user = text('assigneeId')
      return user ? `No one on the team has the id ${user}.` : 'No one on the team matches that.'
    }
    case 'VERSION_EXISTS': {
      const version = text('version') ?? 'That version'
      const environment = text('environment')
      if (toolName === 'run_deployment') {
        return environment
          ? `${version} is already live in ${environment}.`
          : `${version} is already live.`
      }
      return `Release notes for ${version} already exist.`
    }
    case 'DEPLOY_IN_PROGRESS': {
      const environment = text('environment')
      return environment
        ? `A deployment to ${environment} is already running.`
        : 'A deployment is already running.'
    }
    case 'DEPLOY_ALREADY_SETTLED':
      return 'That deployment had already finished.'
    case 'STAGE_FAILED':
      return 'A deployment stage failed.'
    case 'WORKSPACE_FULL':
      return 'The board is full. Reset it to carry on.'
    case 'INVALID_INPUT':
      return 'The board couldn’t accept that request.'
    default:
      return 'That didn’t go through.'
  }
}
