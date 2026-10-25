import { describe, expect, it } from 'vitest'
import type { ToolErrorCode } from '@devsprint/shared'
import { errorCopyText, toolErrorCopy as copyParts } from './error-copy'

/** The copy as the reader sees it, identifiers and all. */
const toolErrorCopy = (...args: Parameters<typeof copyParts>) => errorCopyText(copyParts(...args))

describe('toolErrorCopy', () => {
  it('says an undo the board refused in one sentence, whichever the reason', () => {
    // Moved on since, already undone, or a reset: to the reader, all one thing.
    expect(toolErrorCopy('undo', 'UNDO_CONFLICT', { issueKey: 'ds-9' })).toBe(
      'That change to DS-9 can’t be undone: the board has moved on.',
    )
    expect(copyParts('undo', 'UNDO_CONFLICT', { issueKey: 'DS-9' })).toContainEqual({ id: 'DS-9' })
    expect(toolErrorCopy('undo', 'UNDO_CONFLICT')).toBe(
      'That change can’t be undone: the board has moved on.',
    )
  })

  it('names the issue the board does not hold, as the board spells keys (S-E)', () => {
    expect(toolErrorCopy('update_issue_status', 'ISSUE_NOT_FOUND', { issueKey: ' ds-42 ' })).toBe(
      'No issue DS-42 on the board.',
    )
    expect(toolErrorCopy('update_issue_status', 'ISSUE_NOT_FOUND')).toBe(
      'That issue isn’t on the board.',
    )
  })

  it('has words for every code in the shared envelope', () => {
    // A new code must not fall through to the generic line unnoticed.
    const codes: ToolErrorCode[] = [
      'ISSUE_NOT_FOUND',
      'SPRINT_NOT_FOUND',
      'USER_NOT_FOUND',
      'VERSION_EXISTS',
      'DEPLOY_IN_PROGRESS',
      'DEPLOY_ALREADY_SETTLED',
      'STAGE_FAILED',
      'WORKSPACE_FULL',
      'UNDO_CONFLICT',
      'INVALID_INPUT',
    ]
    const fallback = toolErrorCopy('list_issues', 'SOMETHING_NEW')
    expect(fallback).toBe('That didn’t go through.')
    for (const code of codes) {
      const copy = toolErrorCopy('list_issues', code)
      expect(copy, code).not.toBe(fallback)
      // Never a tool name, never snake_case, never the code itself.
      expect(copy, code).not.toMatch(/_/)
    }
  })

  it('reads the call’s own arguments where the code is about one of them', () => {
    expect(toolErrorCopy('get_burndown', 'SPRINT_NOT_FOUND', { sprintId: 'sprint-99' })).toBe(
      'No sprint with the id sprint-99.',
    )
    expect(toolErrorCopy('get_sprint_status', 'SPRINT_NOT_FOUND', {})).toBe(
      'There is no active sprint.',
    )
    expect(toolErrorCopy('list_issues', 'USER_NOT_FOUND', { assigneeId: 'u-zoe' })).toBe(
      'No one on the team has the id u-zoe.',
    )
    expect(
      toolErrorCopy('run_deployment', 'DEPLOY_IN_PROGRESS', {
        version: 'v1.5.0',
        environment: 'staging',
      }),
    ).toBe('A deployment to staging is already running.')
  })

  it('tells a version already released apart from notes already saved', () => {
    expect(
      toolErrorCopy('run_deployment', 'VERSION_EXISTS', {
        version: 'v1.4.2',
        environment: 'production',
      }),
    ).toBe('v1.4.2 is already live in production.')
    expect(toolErrorCopy('create_release_notes', 'VERSION_EXISTS', { version: 'v1.4.2' })).toBe(
      'Release notes for v1.4.2 already exist.',
    )
  })

  it('marks each identifier it names, so the card can set it in mono', () => {
    expect(copyParts('update_issue_status', 'ISSUE_NOT_FOUND', { issueKey: 'ds-42' })).toEqual([
      'No issue ',
      { id: 'DS-42' },
      ' on the board.',
    ])
    const identifiers = (copy: ReturnType<typeof copyParts>) =>
      copy.flatMap((part) => (typeof part === 'string' ? [] : [part.id]))
    expect(
      identifiers(
        copyParts('run_deployment', 'VERSION_EXISTS', {
          version: 'v1.4.2',
          environment: 'production',
        }),
      ),
    ).toEqual(['v1.4.2', 'production'])
    expect(
      identifiers(copyParts('get_burndown', 'SPRINT_NOT_FOUND', { sprintId: 'sprint-99' })),
    ).toEqual(['sprint-99'])
    expect(identifiers(copyParts('list_issues', 'WORKSPACE_FULL'))).toEqual([])
  })

  it('says an assignment that changed nothing, and an assignee nobody on the team has', () => {
    expect(toolErrorCopy('assign_issue', 'INVALID_INPUT', { issueKey: 'ds-9' })).toBe(
      'DS-9 already has that assignee.',
    )
    expect(copyParts('assign_issue', 'INVALID_INPUT', { issueKey: 'DS-9' })).toContainEqual({
      id: 'DS-9',
    })
    expect(toolErrorCopy('assign_issue', 'INVALID_INPUT')).toBe(
      'That issue already has that assignee.',
    )
    // The generic line still covers every other tool's malformed request.
    expect(toolErrorCopy('create_issue', 'INVALID_INPUT', { issueKey: 'DS-9' })).toBe(
      'The board couldn’t accept that request.',
    )
    expect(
      toolErrorCopy('assign_issue', 'USER_NOT_FOUND', { issueKey: 'DS-12', assigneeId: 'u-zed' }),
    ).toBe('No one on the team has the id u-zed.')
  })

  it('reads whole without a version to name', () => {
    expect(toolErrorCopy('create_release_notes', 'VERSION_EXISTS', {})).toBe(
      'Release notes for that version already exist.',
    )
  })

  it('names the recovery when there is one', () => {
    expect(toolErrorCopy('create_issue', 'WORKSPACE_FULL')).toBe(
      'The board is full. Reset it to carry on.',
    )
  })
})
