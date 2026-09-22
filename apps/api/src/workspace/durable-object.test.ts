import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDO } from './durable-object'
import { fakeDurableObjectState } from '../../test/durable-object-state'

/**
 * `WorkspaceDO` itself, not the parallel in-memory implementation the rest of
 * the suite drives. ADR-0011 called this gap out explicitly — the object's own
 * storage behaviour was covered only by the live smoke — and the alarm and the
 * ledger added in ADR-0014 are exactly that kind of behaviour: neither exists
 * in `createLocalWorkspaceApi` because neither is domain logic.
 */
async function freshDO() {
  const fake = fakeDurableObjectState()
  const stub = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
  await fake.ready()
  return { fake, stub }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WorkspaceDO — daily reset alarm', () => {
  it('arms an alarm for the next UTC midnight as soon as it exists', async () => {
    const before = Date.now()
    const { fake } = await freshDO()
    const after = Date.now()

    const alarmAt = fake.alarmAt()
    expect(alarmAt).not.toBeNull()
    // A UTC midnight, exactly — not just "sometime tomorrow".
    expect(new Date(alarmAt!).toISOString()).toMatch(/T00:00:00\.000Z$/)
    // Strictly in the future, and no more than a day out: this is "tomorrow",
    // not some far boundary reachable by flooring incorrectly.
    expect(alarmAt).toBeGreaterThan(before)
    expect(alarmAt! - after).toBeLessThanOrEqual(86_400_000)
  })

  it('does not rearm an object that already has one', async () => {
    // Modelled as constructing twice against the same storage — the same code
    // path a hibernating object wakes back into: `getAlarm()` already returns
    // something, so the constructor must leave it alone.
    const fake = fakeDurableObjectState()
    new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    const firstAlarm = fake.alarmAt()

    new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()

    expect(fake.alarmAt()).toBe(firstAlarm)
  })

  it('resets the board when the alarm fires, and reschedules itself', async () => {
    const { fake, stub } = await freshDO()
    await stub.updateIssueStatus({ issueKey: 'DS-7', status: 'done' })
    expect((await stub.snapshot()).issues.find((issue) => issue.key === 'DS-7')?.status).toBe(
      'done',
    )

    await stub.alarm()

    expect((await stub.snapshot()).issues.find((issue) => issue.key === 'DS-7')?.status).toBe(
      'in_review',
    )
    // One alarm is spent once it fires — without a fresh one armed, the next
    // day's reset would not happen on its own. Recomputed "from now" a moment
    // later, this lands on the same midnight the constructor already armed
    // rather than a later one — that is correct, not stale.
    const alarmAt = fake.alarmAt()
    expect(alarmAt).not.toBeNull()
    expect(new Date(alarmAt!).toISOString()).toMatch(/T00:00:00\.000Z$/)
    expect(alarmAt!).toBeGreaterThan(Date.now())
  })

  it('really persists the alarm-triggered reset, not just the in-memory cache', async () => {
    // `snapshot()` on the same instance would pass even if `save()` never
    // wrote to storage at all, since `load()` short-circuits on `this.workspace`
    // once it is populated. A second object against the same storage is the
    // only way to prove the write actually landed.
    const fake = fakeDurableObjectState()
    const first = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    await first.updateIssueStatus({ issueKey: 'DS-7', status: 'done' })

    await first.alarm()

    const second = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    expect((await second.snapshot()).issues.find((issue) => issue.key === 'DS-7')?.status).toBe(
      'in_review',
    )
  })

  it('rearms before resetting, so a reset that fails still leaves tomorrow armed', async () => {
    // The property the code comment on alarm() claims: if reset() throws
    // partway through, the object should only miss *today's* reset, not stop
    // rearming forever. Swapping the two lines back — reset, then rearm —
    // would fail this test, because the failing put would throw before
    // setAlarm ever ran, leaving the alarm at whatever it already was.
    //
    // Real time is faked and advanced by a day between arming and firing, so
    // the two computed midnights are genuinely different values — without
    // that, both calls land on the same UTC day in a fast test run and
    // "changed" is indistinguishable from "recomputed to the same thing".
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-07-01T09:00:00Z'))
    const { fake, stub } = await freshDO()
    const armedByConstructor = fake.alarmAt()!
    expect(armedByConstructor).toBe(Date.parse('2026-07-02T00:00:00Z'))

    vi.setSystemTime(Date.parse('2026-07-02T09:00:00Z'))
    fake.failNextPut('workspace')
    await expect(stub.alarm()).rejects.toThrow()

    expect(fake.alarmAt()).toBe(Date.parse('2026-07-03T00:00:00Z'))
  })

  it('leaves the alarm alone on a manual reset — the two stay independent', async () => {
    // ADR-0014: manual reset "does not reschedule the alarm... so the daily
    // boundary stays predictable regardless of how often someone resets by
    // hand." Nothing else in this file asserts that in either direction.
    const { fake, stub } = await freshDO()
    const armedByConstructor = fake.alarmAt()

    await stub.reset()

    expect(fake.alarmAt()).toBe(armedByConstructor)
  })
})

describe('WorkspaceDO — write durability', () => {
  it('does not keep a mutation the storage write rejected', async () => {
    // The cache used to be updated before the write was known to have landed,
    // so a rejected write left the object serving a board storage had never
    // accepted — and since every later write persists that same cached object,
    // one failure poisoned every write after it.
    const { fake, stub } = await freshDO()

    fake.failNextPut('workspace')
    await expect(
      stub.createIssue({ title: 'doomed', type: 'bug', priority: 'medium', sprintId: null }),
    ).rejects.toThrow()

    // Not in the cache...
    const after = await stub.snapshot()
    expect(after.issues.some((issue) => issue.title === 'doomed')).toBe(false)
    // ...and the next write still works, rather than replaying the failure.
    const next = await stub.createIssue({
      title: 'after the failure',
      type: 'bug',
      priority: 'medium',
      sprintId: null,
    })
    expect(next.ok).toBe(true)
    expect((await stub.snapshot()).issues.some((i) => i.title === 'after the failure')).toBe(true)
  })

  it('refuses a write that would push the board past its ceiling', async () => {
    // Field-level bounds stop one huge string; this is the other direction —
    // many ordinary writes, which the public MCP server's ungated create_issue
    // makes reachable. Reaching the storage backend's own cliff instead would
    // take the board down for everyone until a reset.
    const { stub } = await freshDO()

    let full
    for (let i = 0; i < 400; i += 1) {
      full = await stub.createIssue({
        title: `filler ${i}`,
        description: 'x'.repeat(4_000),
        type: 'chore',
        priority: 'medium',
        sprintId: null,
      })
      if (!full.ok) break
    }

    expect(full?.ok).toBe(false)
    expect(full?.ok === false && full.error.code).toBe('WORKSPACE_FULL')
    // Refused cleanly, not by throwing — and the board is still readable.
    expect((await stub.snapshot()).issues.length).toBeGreaterThan(0)
  })
})

describe('WorkspaceDO — approval ledger', () => {
  it('spends an id once, and reports it on every later attempt', async () => {
    const { stub } = await freshDO()

    await expect(stub.spendApprovals(['a1'])).resolves.toEqual([])
    await expect(stub.spendApprovals(['a1'])).resolves.toEqual(['a1'])
    await expect(stub.spendApprovals(['a1'])).resolves.toEqual(['a1'])
  })

  it('leaves the cache untouched when the write fails, so a retry sees the truth', async () => {
    // Building the next ledger as its own copy, and only committing it to
    // `this.ledger` once storage confirms the write, is what this proves:
    // mutating the cache first would leave this instance believing 'a1' is
    // spent even though nothing durable ever recorded it.
    const { fake, stub } = await freshDO()

    fake.failNextPut('spent-approvals')
    await expect(stub.spendApprovals(['a1'])).rejects.toThrow()

    // Storage never took it — checked before the retry, because after the
    // retry succeeds storage holds the id either way and the assertion would
    // prove nothing.
    expect(fake.raw.get('spent-approvals')).toBeUndefined()

    // Nor did the cache: a second attempt sees a fresh id, not a spent one.
    await expect(stub.spendApprovals(['a1'])).resolves.toEqual([])
    // And that retry is what actually persisted it.
    expect(fake.raw.get('spent-approvals')).toEqual(['a1'])
  })

  it('reports only the ids that were already spent, from a mixed batch', async () => {
    const { stub } = await freshDO()
    await stub.spendApprovals(['a1'])

    await expect(stub.spendApprovals(['a1', 'a2', 'a3'])).resolves.toEqual(['a1'])
    // a2 and a3 are now spent too, from that same call.
    await expect(stub.spendApprovals(['a2'])).resolves.toEqual(['a2'])
  })

  it('persists the ledger across a fresh load, the same as the board', async () => {
    // `this.ledger` is cached per instance; this proves the durability is in
    // storage, not just the in-memory cache surviving because nothing cleared it.
    const fake = fakeDurableObjectState()
    const first = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    await first.spendApprovals(['a1'])

    const second = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()

    await expect(second.spendApprovals(['a1'])).resolves.toEqual(['a1'])
  })

  it('clears the ledger on reset, along with the board', async () => {
    const { stub } = await freshDO()
    await stub.spendApprovals(['a1'])

    await stub.reset()

    await expect(stub.spendApprovals(['a1'])).resolves.toEqual([])
  })

  it('catches a repeated id within one call, not just across calls', async () => {
    // The interface says callers should deduplicate first, but the guarantee
    // should not depend on every caller remembering to. Filter-then-bulk-add
    // would report neither copy as a replay; checking one at a time does.
    const { stub } = await freshDO()

    await expect(stub.spendApprovals(['a1', 'a1'])).resolves.toEqual(['a1'])
  })

  it('evicts the oldest ids once the ledger grows past its cap', async () => {
    // Guards against `saveLedger` throwing once the serialized ledger nears
    // Durable Object storage's 128 KiB per-value limit on a very busy day.
    const { stub } = await freshDO()

    const ids = Array.from({ length: 2001 }, (_, index) => `a${index}`)
    await stub.spendApprovals(ids)

    // The very first id spent is the one evicted — replaying it now looks
    // like a fresh approval, which is the accepted cost of not crashing.
    await expect(stub.spendApprovals(['a0'])).resolves.toEqual([])
    // Everything else spent in that call is still remembered.
    await expect(stub.spendApprovals(['a2000'])).resolves.toEqual(['a2000'])
  })
})
