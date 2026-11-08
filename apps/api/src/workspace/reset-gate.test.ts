import { describe, expect, it } from 'vitest'
import { createResetGate, resetCooldownRefusal } from './reset-gate'

const COOLDOWN = 30_000
const accepted = { ok: true as const, data: {} as never }

describe('createResetGate', () => {
  it('asks the Durable Object until it has learned something', () => {
    expect(createResetGate().check(0, COOLDOWN)).toBeUndefined()
  })

  it('refuses until the cooldown after an accepted reset has passed', () => {
    const gate = createResetGate()
    gate.learn(1_000, COOLDOWN, accepted)

    expect(gate.check(1_000, COOLDOWN)).toEqual(resetCooldownRefusal(30))
    expect(gate.check(21_500, COOLDOWN)?.retryAfterSeconds).toBe(10)
    expect(gate.check(30_999, COOLDOWN)?.retryAfterSeconds).toBe(1)
    expect(gate.check(31_000, COOLDOWN)).toBeUndefined()
  })

  it('learns from a refusal no more than the rounded-up wait guarantees', () => {
    const gate = createResetGate()
    // The object said 5 s, which means more than 4 s were left.
    gate.learn(10_000, COOLDOWN, resetCooldownRefusal(5))

    expect(gate.check(13_999, COOLDOWN)).toBeDefined()
    expect(gate.check(14_000, COOLDOWN)).toBeUndefined()
  })

  it('learns nothing from a one-second refusal', () => {
    const gate = createResetGate()
    gate.learn(10_000, COOLDOWN, resetCooldownRefusal(1))
    expect(gate.check(10_000, COOLDOWN)).toBeUndefined()
  })

  it('never moves its bound back', () => {
    const gate = createResetGate()
    gate.learn(1_000, COOLDOWN, accepted)
    // A later, shorter refusal does not shorten what an accepted reset taught.
    gate.learn(2_000, COOLDOWN, resetCooldownRefusal(2))
    expect(gate.check(20_000, COOLDOWN)).toBeDefined()
  })

  it('refuses nothing and learns nothing without a cooldown', () => {
    const gate = createResetGate()
    gate.learn(1_000, 0, accepted)
    expect(gate.check(1_000, 0)).toBeUndefined()
    expect(gate.check(1_000, COOLDOWN)).toBeUndefined()
  })
})
