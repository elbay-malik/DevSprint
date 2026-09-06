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

  it('tells the model that writes exist and are approved one at a time', () => {
    // The Phase 4 prompt said writes did not exist. Left in place, a real model
    // would refuse every gated tool while the scripted mock — which ignores the
    // prompt entirely — kept the tests green.
    expect(prompt).not.toMatch(/write actions are not available/i)
    expect(prompt).toContain('update_issue_status')
    expect(prompt).toMatch(/one call per change/i)
    expect(prompt).toMatch(/denied/i)
  })

  it('offers the deploy tool rather than still calling it unavailable', () => {
    // Same trap as the writes above, one phase later: the Phase 4 prompt said
    // deploying was not available yet. Left in place, a real model would refuse
    // every deploy while the scripted mock kept Phase 8 green.
    expect(prompt).not.toMatch(/not available yet/i)
    expect(prompt).toContain('run_deployment')
    // The parts a model gets wrong without being told: re-calling a run it can
    // see was cancelled, and skipping tests nobody asked to skip.
    expect(prompt).toMatch(/cancelled/i)
    expect(prompt).toMatch(/skipTests/)
  })

  it('is deterministic', () => {
    expect(buildSystemPrompt(createWorkspaceSeed())).toBe(prompt)
  })
})
