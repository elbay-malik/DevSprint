import { afterEach, describe, expect, it, vi } from 'vitest'
import { STALE_RUN_MS, WorkspaceDO } from './durable-object'
import { MAX_MCP_CREATED_ISSUES } from './mutations'
import type { BoardChange } from './changes'
import {
  addClientTokens,
  CLIENT_USAGE_MAX,
  refundClientTokens,
  type ClientUsage,
} from './client-usage'
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
    // many ordinary writes. New issues hit their own day cap long before this
    // (see the hardening tests below), so release notes, the other write that
    // grows the board, are what reach it. Reaching the storage backend's own
    // cliff instead would take the board down for everyone until a reset.
    const { stub } = await freshDO()

    let full
    for (let i = 0; i < 400; i += 1) {
      full = await stub.createReleaseNotes({
        version: `v9.${i}.0`,
        markdown: 'x'.repeat(20_000),
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
    // Keeps the stored ledger bounded on a very busy day, so `saveLedger`
    // never has to refuse new ids.
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

  it('records an assignment, and undoes it from storage after a fresh load', async () => {
    const fake = fakeDurableObjectState()
    const first = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    const assigned = await first.assignIssue({ issueKey: 'DS-12', assigneeId: 'u-dana' })
    expect(assigned).toMatchObject({ ok: true, data: { previousAssigneeId: null } })
    const changeId = assigned.ok ? assigned.data.changeId : undefined
    expect(changeId).toMatch(/^[0-9a-f-]{36}$/)

    const second = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    expect((await second.snapshot()).issues.find((i) => i.key === 'DS-12')?.assigneeId).toBe(
      'u-dana',
    )
    const undone = await second.undoChange({ changeId: changeId! })

    expect(undone).toMatchObject({ ok: true, data: { tool: 'assign_issue', outcome: 'restored' } })
    expect((await second.snapshot()).issues.find((i) => i.key === 'DS-12')?.assigneeId).toBeNull()
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

describe('WorkspaceDO — per-client share of the budget', () => {
  const held = (fake: ReturnType<typeof fakeDurableObjectState>) =>
    fake.raw.get('daily-client-usage') as ClientUsage | undefined

  it('counts each client on its own, and every client toward the day', async () => {
    const { stub } = await freshDO()

    await stub.recordModelUsage(1_000, '203.0.113.7')
    await stub.recordModelUsage(500, '203.0.113.7')
    const other = await stub.recordModelUsage(200, '198.51.100.4')

    expect(other).toMatchObject({ tokens: 1_700, clientTokens: 200 })
    expect((await stub.modelUsage('203.0.113.7')).clientTokens).toBe(1_500)
    expect((await stub.modelUsage('192.0.2.1')).clientTokens).toBe(0)
  })

  it('leaves the shape alone when no client is named', async () => {
    const { fake, stub } = await freshDO()

    await stub.recordModelUsage(1_000)

    expect(await stub.modelUsage()).not.toHaveProperty('clientTokens')
    expect(held(fake)).toBeUndefined()
  })

  it('stores a hash, never the key it was given', async () => {
    const { fake, stub } = await freshDO()

    await stub.recordModelUsage(1_000, '2001:db8:1:2::/64')

    const stored = JSON.stringify(held(fake))
    expect(stored).not.toContain('2001')
    expect(Object.keys(held(fake)?.tokens ?? {})).toEqual([expect.stringMatching(/^[0-9a-f]{32}$/)])
  })

  it('hashes before it reads, so nothing waits between the read and the write', async () => {
    // Only storage calls hold other requests back. A real object would let two
    // steps interleave across a digest there, which the fake can't show directly.
    const { fake, stub } = await freshDO()
    const digest = vi.spyOn(crypto.subtle, 'digest')
    const read = vi.spyOn(fake.ctx.storage, 'get')

    await stub.recordModelUsage(1_000, '203.0.113.7')

    expect(digest.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]!)
    digest.mockRestore()
  })

  it('survives a reset, because a share a visitor can clear is not a share', async () => {
    const { stub } = await freshDO()
    await stub.recordModelUsage(5_000, '203.0.113.7')

    await stub.reset()

    expect((await stub.modelUsage('203.0.113.7')).clientTokens).toBe(5_000)
  })

  it('persists across a fresh load of the object', async () => {
    const fake = fakeDurableObjectState()
    const first = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    await first.recordModelUsage(4_200, '203.0.113.7')

    const second = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()

    expect((await second.modelUsage('203.0.113.7')).clientTokens).toBe(4_200)
  })

  it('rolls over with the day, and the next write drops the old entries', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-23T22:00:00Z'))
    const { fake, stub } = await freshDO()
    await stub.recordModelUsage(9_000, '203.0.113.7')
    const yesterday = Object.keys(held(fake)?.tokens ?? {})

    vi.setSystemTime(Date.parse('2026-09-24T00:30:00Z'))

    expect((await stub.modelUsage('203.0.113.7')).clientTokens).toBe(0)
    await stub.recordModelUsage(100, '203.0.113.7')
    expect(held(fake)?.day).toBe('2026-09-24')
    const today = Object.keys(held(fake)?.tokens ?? {})
    expect(today).toHaveLength(1)
    // The same client hashes differently, so days can't be matched up.
    expect(today).not.toEqual(yesterday)
  })

  it("has the midnight alarm remove the old day's map, with or without a new write", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-23T22:00:00Z'))
    const { fake, stub } = await freshDO()
    await stub.recordModelUsage(9_000, '203.0.113.7')

    vi.setSystemTime(Date.parse('2026-09-24T00:00:00Z'))
    await stub.alarm()

    expect(held(fake)).toBeUndefined()
  })

  it("keeps today's map if an alarm retries during the day", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-24T00:10:00Z'))
    const { stub } = await freshDO()
    await stub.recordModelUsage(9_000, '203.0.113.7')

    await stub.alarm()

    expect((await stub.modelUsage('203.0.113.7')).clientTokens).toBe(9_000)
  })

  it('does not take a slot for a step that reported no usage', async () => {
    const { fake, stub } = await freshDO()

    await stub.recordModelUsage(0, '203.0.113.7')
    await stub.recordModelUsage(Number.NaN, '203.0.113.8')
    await stub.recordModelUsage(-5, '203.0.113.9')

    expect(held(fake)?.tokens).toEqual({})
  })

  it('stays capped, and keeps the client nearest its limit when it is full', async () => {
    const { fake, stub } = await freshDO()
    await stub.recordModelUsage(25_000, 'heavy')

    for (let client = 0; client <= CLIENT_USAGE_MAX; client += 1) {
      await stub.recordModelUsage(1, `client-${client}`)
    }

    expect(Object.keys(held(fake)?.tokens ?? {})).toHaveLength(CLIENT_USAGE_MAX)
    expect((await stub.modelUsage('heavy')).clientTokens).toBe(25_000)
    expect((await stub.modelUsage(`client-${CLIENT_USAGE_MAX}`)).clientTokens).toBe(1)
  })
})

describe('refundModelUsage', () => {
  const held = (fake: ReturnType<typeof fakeDurableObjectState>) =>
    fake.raw.get('daily-client-usage') as ClientUsage | undefined

  it('hashes before it reads, as recording does', async () => {
    const { fake, stub } = await freshDO()
    const digest = vi.spyOn(crypto.subtle, 'digest')
    const read = vi.spyOn(fake.ctx.storage, 'get')

    await stub.refundModelUsage(100, '203.0.113.7')

    expect(digest.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]!)
    digest.mockRestore()
  })

  it('takes tokens back from the day and the client, stopping at zero', async () => {
    const { stub } = await freshDO()
    await stub.recordModelUsage(1_000, '203.0.113.7')
    await stub.recordModelUsage(500, '198.51.100.4')

    const after = await stub.refundModelUsage(400, '203.0.113.7')
    expect(after).toMatchObject({ tokens: 1_100, clientTokens: 600 })

    const emptied = await stub.refundModelUsage(9_000, '203.0.113.7')
    expect(emptied).toMatchObject({ tokens: 0, clientTokens: 0 })
    expect((await stub.modelUsage('198.51.100.4')).clientTokens).toBe(500)
  })

  it('takes tokens back from the day alone when there is no client', async () => {
    const { stub } = await freshDO()
    await stub.recordModelUsage(1_000, '203.0.113.7')

    expect((await stub.refundModelUsage(300)).tokens).toBe(700)
    expect((await stub.modelUsage('203.0.113.7')).clientTokens).toBe(1_000)
  })

  it('cannot add budget or spend through nonsense', async () => {
    const { stub } = await freshDO()
    await stub.recordModelUsage(1_000, '203.0.113.7')

    await stub.refundModelUsage(-500, '203.0.113.7')
    await stub.refundModelUsage(Number.NaN, '203.0.113.7')

    expect(await stub.modelUsage('203.0.113.7')).toMatchObject({
      tokens: 1_000,
      clientTokens: 1_000,
    })
  })

  it('never stores the raw key', async () => {
    const { fake, stub } = await freshDO()
    await stub.recordModelUsage(1_000, '203.0.113.7')

    await stub.refundModelUsage(100, '203.0.113.7')

    expect(JSON.stringify(held(fake))).not.toContain('203.0.113.7')
    expect(Object.values(held(fake)?.tokens ?? {})).toEqual([900])
  })

  it('does not give a client it no longer holds a slot', async () => {
    const { fake, stub } = await freshDO()

    await stub.refundModelUsage(100, '203.0.113.7')

    expect(held(fake)?.tokens).toEqual({})
  })
})

describe('refundClientTokens', () => {
  it('leaves a client it does not hold out of the map', () => {
    expect(refundClientTokens({ a: 10 }, 'b', 5)).toEqual({ a: 10 })
  })

  it('stops at zero', () => {
    expect(refundClientTokens({ a: 10 }, 'a', 25)).toEqual({ a: 0 })
  })
})

describe('addClientTokens', () => {
  it('evicts the lowest spender, and never the client it just wrote', () => {
    const full = { a: 10, b: 2, c: 30 }

    expect(addClientTokens(full, 'new', 1, 3)).toEqual({ a: 10, c: 30, new: 1 })
    expect(addClientTokens({ a: 10, b: 20, c: 30 }, 'new', 1, 3)).toEqual({ b: 20, c: 30, new: 1 })
  })

  it('adds to a client it already holds without evicting anyone', () => {
    expect(addClientTokens({ a: 10, b: 2, c: 30 }, 'b', 5, 3)).toEqual({ a: 10, b: 7, c: 30 })
  })
})

describe('WorkspaceDO — shared-board hardening (ADR-0024)', () => {
  it('stops new issues at the day cap, before the byte cap can stop every write', async () => {
    // The byte cap alone let a few dozen public creates refuse every
    // write for everyone. Quotes are the costliest text the schemas still allow
    // (each serializes as two characters), so this is the largest board a
    // flood can build.
    const { stub } = await freshDO()
    const heavy = {
      title: '"'.repeat(200),
      description: '"'.repeat(4_000),
      type: 'chore' as const,
      priority: 'medium' as const,
      sprintId: null,
      labels: Array.from({ length: 10 }, () => '"'.repeat(40)),
    }

    for (let i = 0; i < 40; i += 1) {
      expect((await stub.createIssue(heavy)).ok).toBe(true)
    }
    const refused = await stub.createIssue(heavy)

    expect(refused.ok === false && refused.error.code).toBe('WORKSPACE_FULL')
    // Everything else still works for everyone else.
    const moved = await stub.updateIssueStatus({ issueKey: 'DS-7', status: 'done' })
    expect(moved.ok).toBe(true)
  })

  it('keeps MCP creates to their share, so the copilot can still file issues', async () => {
    const { fake, stub } = await freshDO()
    const input = {
      title: 'filler',
      type: 'chore' as const,
      priority: 'medium' as const,
      sprintId: null,
    }

    for (let i = 0; i < MAX_MCP_CREATED_ISSUES; i += 1) {
      expect((await stub.createIssue(input, 'mcp')).ok).toBe(true)
    }
    const refused = await stub.createIssue(input, 'mcp')
    const fromApp = await stub.createIssue(input)

    expect(refused.ok === false && refused.error.code).toBe('WORKSPACE_FULL')
    expect(fromApp.ok).toBe(true)
    // The mark is persisted with the board, not just held in the cache: a
    // second object on the same storage reads it, and refuses the same way.
    const second = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    const issues = (await second.snapshot()).issues
    expect(issues.filter((issue) => issue.source === 'mcp')).toHaveLength(MAX_MCP_CREATED_ISSUES)
    expect((await second.createIssue(input, 'mcp')).ok).toBe(false)
  })

  it('frees the MCP share on a reset, the same as the main cap', async () => {
    const { stub } = await freshDO()
    const input = {
      title: 'filler',
      type: 'chore' as const,
      priority: 'medium' as const,
      sprintId: null,
    }
    for (let i = 0; i < MAX_MCP_CREATED_ISSUES; i += 1) await stub.createIssue(input, 'mcp')
    expect((await stub.createIssue(input, 'mcp')).ok).toBe(false)

    await stub.alarm()

    expect((await stub.createIssue(input, 'mcp')).ok).toBe(true)
  })

  it('frees an MCP slot when that create is undone', async () => {
    const { stub } = await freshDO()
    const input = {
      title: 'filler',
      type: 'chore' as const,
      priority: 'medium' as const,
      sprintId: null,
    }
    let last: Awaited<ReturnType<typeof stub.createIssue>> | undefined
    for (let i = 0; i < MAX_MCP_CREATED_ISSUES; i += 1) last = await stub.createIssue(input, 'mcp')
    const changeId = last?.ok ? last.data.changeId : undefined
    if (changeId === undefined) throw new Error('expected the last create to land')

    expect((await stub.undoChange({ changeId })).ok).toBe(true)

    expect((await stub.createIssue(input, 'mcp')).ok).toBe(true)
  })

  it('refuses a visitor reset inside the cooldown, and allows it after', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T09:00:00Z'))
    const { stub } = await freshDO()

    expect((await stub.requestReset({ cooldownMs: 30_000 })).ok).toBe(true)
    vi.setSystemTime(new Date('2026-07-01T09:00:10Z'))
    const early = await stub.requestReset({ cooldownMs: 30_000 })
    vi.setSystemTime(new Date('2026-07-01T09:00:29.900Z'))
    const lastMoment = await stub.requestReset({ cooldownMs: 30_000 })
    vi.setSystemTime(new Date('2026-07-01T09:00:31Z'))
    const later = await stub.requestReset({ cooldownMs: 30_000 })

    expect(early.ok === false && early.error.code).toBe('RESET_COOLDOWN')
    // The refusal says what is left, in whole seconds rounded up, never 0.
    expect(early.ok === false && early.retryAfterSeconds).toBe(20)
    expect(lastMoment.ok === false && lastMoment.retryAfterSeconds).toBe(1)
    expect(later.ok).toBe(true)
  })

  it('cancels a run only with its own token, which never reaches the board', async () => {
    // The board lists every deployment id, so an id alone is public.
    const fake = fakeDurableObjectState()
    const first = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    const started = await first.startDeployment({
      environment: 'staging',
      version: 'v9.9.9',
      skipTests: false,
    })
    if (!started.ok || started.data.cancelToken === undefined) throw new Error('no token')
    const { cancelToken } = started.data
    const deploymentId = started.data.deployment.id

    expect(JSON.stringify(await first.snapshot())).not.toContain(cancelToken)
    const guessed = await first.cancelDeployment({ deploymentId, cancelToken: 'guess' })
    expect(guessed.ok).toBe(false)

    // The token is in storage, not only this instance's cache.
    const second = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    const cancelled = await second.cancelDeployment({ deploymentId, cancelToken })
    expect(cancelled.ok && cancelled.data.deployment.status).toBe('cancelled')
  })

  it('forgets every cancel token on reset, so a stale one cannot stop a new run', async () => {
    // Ids restart from the seed after a reset, so the next run can reuse one.
    const { stub } = await freshDO()
    const input = { environment: 'staging' as const, version: 'v9.9.9', skipTests: false }
    const before = await stub.startDeployment(input)
    if (!before.ok || before.data.cancelToken === undefined) throw new Error('no token')

    await stub.reset()
    const after = await stub.startDeployment(input)
    if (!after.ok) throw new Error('did not start')

    expect(after.data.deployment.id).toBe(before.data.deployment.id)
    const stale = await stub.cancelDeployment({
      deploymentId: after.data.deployment.id,
      cancelToken: before.data.cancelToken,
    })
    expect(stale.ok).toBe(false)
  })
})

describe('WorkspaceDO — abandoned deployments', () => {
  // A run is driven by the request that started it. These model that request
  // going away with the run parked between stages: nothing writes to it again.
  const staging = { environment: 'staging' as const, version: 'v9.9.9', skipTests: false }
  const next = { environment: 'staging' as const, version: 'v9.9.10', skipTests: false }
  const t0 = Date.parse('2026-07-01T09:00:00Z')

  async function startedRun(stub: WorkspaceDO, input = staging) {
    const started = await stub.startDeployment(input)
    if (!started.ok) throw new Error('did not start')
    return started.data.deployment.id
  }

  async function statusOf(stub: WorkspaceDO, id: string) {
    return (await stub.snapshot()).deployments.find((deployment) => deployment.id === id)?.status
  }

  it('settles a run nothing has written to for STALE_RUN_MS, and lets the next one start', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    const { stub } = await freshDO()
    const abandoned = await startedRun(stub)

    vi.setSystemTime(t0 + STALE_RUN_MS + 1)
    const started = await stub.startDeployment(next)

    expect(started.ok).toBe(true)
    expect(await statusOf(stub, abandoned)).toBe('failed')
    // Settled through the usual path, so no stage is left reading `running`.
    const stages = (await stub.snapshot()).deployments.find(
      (deployment) => deployment.id === abandoned,
    )?.stages
    expect(stages?.every((stage) => stage.status === 'skipped')).toBe(true)
  })

  it('still refuses a second start while the first run is writing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    const { stub } = await freshDO()
    const running = await startedRun(stub)

    vi.setSystemTime(t0 + STALE_RUN_MS - 1)
    const refused = await stub.startDeployment(next)

    expect(refused.ok === false && refused.error.code).toBe('DEPLOY_IN_PROGRESS')
    expect(await statusOf(stub, running)).toBe('running')
  })

  it('counts from the last stage write, not from the start', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    const { stub } = await freshDO()
    const running = await startedRun(stub)

    vi.setSystemTime(t0 + 20_000)
    await stub.setDeploymentStage({ deploymentId: running, stage: 'build', status: 'running' })
    vi.setSystemTime(t0 + STALE_RUN_MS + 1)
    const refused = await stub.startDeployment(next)
    expect(refused.ok === false && refused.error.code).toBe('DEPLOY_IN_PROGRESS')

    vi.setSystemTime(t0 + 20_000 + STALE_RUN_MS + 1)
    expect((await stub.startDeployment(next)).ok).toBe(true)
    expect(await statusOf(stub, running)).toBe('failed')
  })

  it('stops a run that turns out to be alive, at its next write', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    const { stub } = await freshDO()
    const late = await startedRun(stub)
    vi.setSystemTime(t0 + STALE_RUN_MS + 1)
    await stub.startDeployment(next)

    const resumed = await stub.setDeploymentStage({
      deploymentId: late,
      stage: 'build',
      status: 'running',
    })

    // The settled outcome stands; the late write does not reopen a stage.
    expect(resumed.ok && resumed.data.deployment.status).toBe('failed')
    expect(resumed.ok && resumed.data.deployment.stages[0]?.status).toBe('skipped')
  })

  it('gives a run with no heartbeat one on first sight, rather than settling it at once', async () => {
    // A run stored before heartbeats existed. The board's timestamps are the
    // frozen demo clock, so they cannot say how old it is.
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    const fake = fakeDurableObjectState()
    const first = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    const legacy = await startedRun(first)
    fake.raw.delete('deployment-heartbeats')

    const woken = new WorkspaceDO(fake.ctx, {} as Cloudflare.Env)
    await fake.ready()
    vi.setSystemTime(t0 + 60_000)
    const refused = await woken.startDeployment(next)
    expect(refused.ok === false && refused.error.code).toBe('DEPLOY_IN_PROGRESS')

    vi.setSystemTime(t0 + 60_000 + STALE_RUN_MS + 1)
    expect((await woken.startDeployment(next)).ok).toBe(true)
    expect(await statusOf(woken, legacy)).toBe('failed')
  })

  it('forgets the heartbeat once the run settles, and on reset', async () => {
    const { fake, stub } = await freshDO()
    const finished = await startedRun(stub)
    expect(Object.keys(fake.raw.get('deployment-heartbeats') as object)).toEqual([finished])

    await stub.finishDeployment({ deploymentId: finished, status: 'succeeded' })
    expect(fake.raw.get('deployment-heartbeats')).toEqual({})

    const second = await startedRun(stub, next)
    expect(Object.keys(fake.raw.get('deployment-heartbeats') as object)).toEqual([second])
    await stub.reset()
    expect(fake.raw.get('deployment-heartbeats')).toEqual({})
  })
})
