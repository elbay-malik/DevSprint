import { describe, expect, it } from 'vitest'
import { matchStrength } from './match-strength'

describe('matchStrength', () => {
  it('follows the weights search_issues scores with (title 3, key 3, labels 2, description 1)', () => {
    // A named key, and every query word in the title and labels (5/9).
    expect(matchStrength(1)).toBe('Strong')
    expect(matchStrength(0.56)).toBe('Strong')
    // Every query word in the title, rounded to two places as the api does (3/9).
    expect(matchStrength(0.33)).toBe('Good')
    expect(matchStrength(0.44)).toBe('Good')
    // Half the title, or the description alone (1/9).
    expect(matchStrength(0.17)).toBe('Weak')
    expect(matchStrength(0.11)).toBe('Weak')
  })

  it('places each threshold on its own side', () => {
    expect(matchStrength(0.5)).toBe('Strong')
    expect(matchStrength(0.49)).toBe('Good')
    expect(matchStrength(0.32)).toBe('Weak')
  })
})
