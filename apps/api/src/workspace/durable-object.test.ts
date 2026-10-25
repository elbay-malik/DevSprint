import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDO } from './durable-object'
import type { BoardChange } from './changes'
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

describe('WorkspaceDO — undo journal', () => {
  async function approvedDone(stub: WorkspaceDO) {
    const result = await stub.updateIssueStatus({ issueKey: 'DS-7', status: 'done' })
    if (!result.ok || result.data.changeId === undefined) throw new Error('write was not recorded')
    return result.data.changeId
  }

  it('mints a change id on every recorded write', async () => {
    const { stub } = await freshDO()
    const first = await approvedDone(stub)
    const created = await stub.createIssue({
      title: 'Flaky login test',
      type: 'bug',
      priority: 'high',
      sprintId: null,
    })

    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.ok && created.data.changeId).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.ok && created.data.changeId).not.toBe(first)
  })

  it('persists the record with the board, so an undo survives a fresh load', async () => {
    const fake = fakeDurableObjectState()
    const first = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    const changeId = await approvedDone(first)

    const second = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    const undone = await second.undoChange({ changeId })

    expect(undone.ok).toBe(true)
    expect((await second.snapshot()).issues.find((issue) => issue.key === 'DS-7')?.status).toBe(
      'in_review',
    )
  })

  it('reads the before-state from its own storage', async () => {
    // Rewrite the stored record behind the object's back, then load fresh:
    // the undo follows the record, which is the only thing it ever consults.
    const fake = fakeDurableObjectState()
    const first = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    const changeId = await approvedDone(first)
    const stored = fake.raw.get('board-changes') as BoardChange[]
    fake.raw.set('board-changes', [
      { ...stored[0]!, before: { ...stored[0]!.before!, status: 'blocked' } },
    ])

    const second = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    await second.undoChange({ changeId })

    expect((await second.snapshot()).issues.find((issue) => issue.key === 'DS-7')?.status).toBe(
      'blocked',
    )
  })

  it('keeps neither the write nor its record when storage rejects them', async () => {
    const { fake, stub } = await freshDO()
    fake.failNextPut('board-changes')
    await expect(stub.updateIssueStatus({ issueKey: 'DS-7', status: 'done' })).rejects.toThrow()

    expect((await stub.snapshot()).issues.find((issue) => issue.key === 'DS-7')?.status).toBe(
      'in_review',
    )
    expect(fake.raw.get('board-changes')).toBeUndefined()
  })

  it('keeps an undo the storage write rejected from landing in the cache', async () => {
    const { fake, stub } = await freshDO()
    const changeId = await approvedDone(stub)

    fake.failNextPut('workspace')
    await expect(stub.undoChange({ changeId })).rejects.toThrow()

    expect((await stub.snapshot()).issues.find((issue) => issue.key === 'DS-7')?.status).toBe(
      'done',
    )
    // Not marked undone either, so the retry still goes through.
    await expect(stub.undoChange({ changeId })).resolves.toMatchObject({ ok: true })
  })

  it('forgets every change on reset', async () => {
    const { fake, stub } = await freshDO()
    const changeId = await approvedDone(stub)

    await stub.reset()

    const result = await stub.undoChange({ changeId })
    expect(result.ok === false && result.error.code).toBe('UNDO_CONFLICT')
    expect(fake.raw.get('board-changes')).toEqual([])
  })
})

describe('WorkspaceDO — daily model budget', () => {
  it('accumulates spend and hands back the day it belongs to', async () => {
    const { stub } = await freshDO()

    expect((await stub.modelUsage()).tokens).toBe(0)
    await stub.recordModelUsage(1_200)
    const after = await stub.recordModelUsage(800)

    expect(after.tokens).toBe(2_000)
    expect(after.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('survives a reset, because a cap a visitor can clear is not a cap', async () => {
    const { stub } = await freshDO()
    await stub.recordModelUsage(5_000)

    await stub.reset()

    expect((await stub.modelUsage()).tokens).toBe(5_000)
  })

  it('rolls over on the real UTC date, not the frozen demo clock', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-23T22:00:00Z'))
    const { stub } = await freshDO()
    await stub.recordModelUsage(9_000)
    expect((await stub.modelUsage()).tokens).toBe(9_000)

    // Past midnight UTC: a new day, and a fresh budget — without anything
    // having had to fire, so a Worker asleep across midnight wakes up correct.
    vi.setSystemTime(Date.parse('2026-09-24T00:30:00Z'))

    const rolled = await stub.modelUsage()
    expect(rolled.tokens).toBe(0)
    expect(rolled.day).toBe('2026-09-24')
  })

  it('refuses to let nonsense usage buy back budget', async () => {
    const { stub } = await freshDO()
    await stub.recordModelUsage(1_000)

    await stub.recordModelUsage(-900)
    await stub.recordModelUsage(Number.NaN)

    expect((await stub.modelUsage()).tokens).toBe(1_000)
  })

  it('persists across a fresh load of the object', async () => {
    const fake = fakeDurableObjectState()
    const first = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    await first.recordModelUsage(4_200)

    const second = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()

    expect((await second.modelUsage()).tokens).toBe(4_200)
  })
})
