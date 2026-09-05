import { describe, expect, it } from 'vitest'
import { createWorkspaceSeed, WORKSPACE_NOW } from '@devsprint/shared'
import { buildSystemPrompt } from './system-prompt'

describe('buildSystemPrompt', () => {
  const workspace = createWorkspaceSeed()
  const prompt = buildSystemPrompt(workspace)

  it('pins the fixed demo clock', () => {
    expect(prompt).toContain(WORKSPACE_NOW)
    expect(prompt).toMatch(/do not use real-world today/i)
  })

  it('embeds the whole roster so names resolve without a list_users tool', () => {
    for (const user of workspace.users) {
      expect(prompt).toContain(user.id)
      expect(prompt).toContain(user.name)
      expect(prompt).toContain(`@${user.handle}`)
    }
  })

  it('names the active sprint', () => {
    expect(prompt).toContain('sprint-12')
    expect(prompt).toMatch(/active \(current\) sprint is sprint-12/)
  })

  it('tells the model writes do not exist yet', () => {
    expect(prompt).toMatch(/write actions are not available yet/i)
  })

  it('is deterministic', () => {
    expect(buildSystemPrompt(createWorkspaceSeed())).toBe(prompt)
  })
})
