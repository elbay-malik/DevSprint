/**
 * How well a search result matched, as a word. `search_issues` scores a match
 * as the weighted share of the query found in each field, over a total weight
 * of 9: title 3, key 3, labels 2, description 1 (apps/api queries.ts). So:
 *
 * - Strong, from 0.5: more than the title alone. Every word in the title and
 *   the labels is 5/9 (0.56), and a named key is 1.
 * - Good, from 0.33: as much as every word in the title (3/9).
 * - Weak, below: a partial title hit, or words found only in the description.
 */
export type MatchStrength = 'Strong' | 'Good' | 'Weak'

export const STRONG_MATCH = 0.5
export const GOOD_MATCH = 0.33

export function matchStrength(score: number): MatchStrength {
  if (score >= STRONG_MATCH) return 'Strong'
  if (score >= GOOD_MATCH) return 'Good'
  return 'Weak'
}
