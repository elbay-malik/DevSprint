import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed } from '@devsprint/shared'
import { findIssueByKey } from './issue-key'

const { issues } = createWorkspaceSeed()

describe('findIssueByKey', () => {
  it('finds an issue by its exact key', () => {
    expect(findIssueByKey(issues, 'DS-7')?.key).toBe('DS-7')
  })

  it('matches a lowercase or padded key, as the api does', () => {
    expect(findIssueByKey(issues, 'ds-7')?.key).toBe('DS-7')
    expect(findIssueByKey(issues, '  DS-7 ')?.key).toBe('DS-7')
    expect(findIssueByKey(issues, ' ds-11\n')?.key).toBe('DS-11')
  })

  it('finds nothing for a key the board does not hold', () => {
    expect(findIssueByKey(issues, 'DS-42')).toBeUndefined()
    expect(findIssueByKey(issues, '')).toBeUndefined()
  })
})
