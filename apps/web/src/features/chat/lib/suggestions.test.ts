import { describe, expect, it } from 'vitest'
import scenarios from '../../../../../../docs/demo-scenarios.md?raw'
import { SUGGESTIONS } from './suggestions'

/** The verbatim prompt of a scenario's step 1, from its step table. */
function firstPrompt(scenario: string): string | undefined {
  const start = scenarios.indexOf(`## ${scenario} —`)
  const section = scenarios.slice(start, scenarios.indexOf('\n## ', start + 1))
  return /^\| 1 +\| User +\| "(.+?)" +\|/m.exec(section)?.[1]
}

describe('SUGGESTIONS', () => {
  it.each(SUGGESTIONS.map((suggestion) => [suggestion.scenario, suggestion] as const))(
    'sends %s’s first prompt exactly as the scenario specifies it',
    (scenario, suggestion) => {
      expect(firstPrompt(scenario)).toBe(suggestion.prompt)
    },
  )

  it('offers every chat scenario once, and at most six at a time', () => {
    expect(SUGGESTIONS.map((suggestion) => suggestion.scenario).sort()).toEqual([
      'S-A',
      'S-B',
      'S-C',
      'S-D',
      'S-E',
    ])
    expect(SUGGESTIONS.length).toBeLessThanOrEqual(6)
  })

  it('labels S-E by what it asks for, not by the missing key it is about to hit', () => {
    // "Fix a typo'd issue key" gave the twist away, and the message it sent
    // ("Mark DS-42 as done…") did not match the chip that was clicked.
    const s_e = SUGGESTIONS.find((suggestion) => suggestion.scenario === 'S-E')
    expect(s_e?.label).toBe('Mark DS-42 as done')
    expect(s_e?.prompt.startsWith(s_e.label)).toBe(true)
    expect(s_e?.label).not.toMatch(/typo/i)
  })

  it('labels each by its outcome in a few words', () => {
    for (const { label } of SUGGESTIONS) expect(label.split(' ').length).toBeLessThanOrEqual(5)
  })
})
