/** A request the empty transcript offers, named for what it gets done. */
export interface Suggestion {
  /** The scenario in docs/demo-scenarios.md whose first prompt this is. */
  scenario: 'S-A' | 'S-B' | 'S-C' | 'S-D' | 'S-E'
  /** The outcome, in a few words: what the chip shows. */
  label: string
  /** Sent exactly as written, so the chip runs the scenario as specified. */
  prompt: string
}

/**
 * The chat scenarios' first prompts, verbatim, so a first-time visitor can run
 * the flows that show the most without guessing what to type. Closing out the
 * sprint comes first, since its approval cards are what the first-visit guide
 * points at; the read follows, then the other gated writes. S-F has no chip: it runs in an outside MCP
 * host, so the empty state offers the MCP address instead.
 */
export const SUGGESTIONS: readonly Suggestion[] = [
  {
    scenario: 'S-B',
    label: 'Close out the sprint',
    prompt:
      "We're closing Sprint 12 today — mark every remaining open issue in the sprint as done.",
  },
  {
    scenario: 'S-D',
    label: 'Is the sprint on track?',
    prompt: 'Is Sprint 12 on track? Show me the burndown.',
  },
  {
    scenario: 'S-A',
    label: 'Draft release notes',
    prompt: 'Summarize Sprint 12 and draft release notes for v1.5.0.',
  },
  {
    scenario: 'S-C',
    label: 'Deploy to staging',
    prompt: 'Deploy v1.5.0-rc.1 to staging.',
  },
  {
    scenario: 'S-E',
    // What the visitor asks for, not the twist: that DS-42 does not exist is
    // the copilot's to find.
    label: 'Mark DS-42 as done',
    prompt: 'Mark DS-42 as done — the billing export shipped this morning.',
  },
]
