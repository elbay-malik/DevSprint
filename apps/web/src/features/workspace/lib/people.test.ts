import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { assigneeLabel, isKnownAssignee } from './people'

const { users } = createWorkspaceSeed()

describe('assigneeLabel', () => {
  it('names a person by @handle, as the board cards do', () => {
    expect(assigneeLabel(users, 'u-dana')).toBe('@dana')
  })

  it('says nobody in words', () => {
    expect(assigneeLabel(users, null)).toBe('Unassigned')
  })

  it('shows an id the roster does not hold as itself, rather than a guess', () => {
    expect(assigneeLabel(users, 'u-zed')).toBe('u-zed')
  })
})

describe('isKnownAssignee', () => {
  it('accepts someone on the roster, and nobody', () => {
    expect(isKnownAssignee(users, 'u-ben')).toBe(true)
    expect(isKnownAssignee(users, null)).toBe(true)
    expect(isKnownAssignee(users, 'u-zed')).toBe(false)
  })
})
