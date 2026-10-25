# ADR-0014: Daily reset alarm and a persisted approval ledger, no per-visitor sessions

- Status: Accepted
- Date: 2026-09-12
- Deciders: repo owner (solo project)

## Context and Problem Statement

Phase 9's line in [roadmap.md](../roadmap.md) reads "D1 persistence + daily reset... per-visitor
session isolation," already narrowed once by ADR-0011: the workspace is durable, so what remains
is "the reset alarm, a session key, and persisting the approval ledger."

Two of those three are unambiguous. The reset alarm and the persisted ledger are both plumbing —
`ctx.storage.setAlarm` and a second storage key on the object that already exists. The third, "a
session key," is not: `durable-object.ts` itself anticipated it back in Phase 6 — "Phase 9 turns
the name into a per-visitor session key" — which reads as every visitor getting a private copy of
the board.

That collides with two things already decided. [product-brief.md](../product-brief.md) lists
"Auth / multi-tenancy" as a **non-goal**, and its second success criterion is "An external MCP host
can operate **the same workspace**" — singular. [ADR-0011](0011-workspace-state-in-a-durable-object.md)
exists specifically because scenario S-F needs the SPA and an external MCP host to land in the exact
same object; the host carries no session of its own to key on, since [ADR-0011](0011-workspace-state-in-a-durable-object.md)
also keeps the MCP servers stateless. Per-visitor isolation would mean picking one of two things to
break: S-F's already-verified "same workspace, two clients," or the non-goal that ruled out building
session/tenant machinery in the first place.

## Decision

**No per-visitor session isolation.** `WORKSPACE_DO_NAME = 'demo'` stays a single fixed name. The
Phase 6 comment anticipating a session key was wrong to anticipate it; this ADR corrects it.

What Phase 9 actually builds:

- **A daily reset alarm.** `WorkspaceDO`'s constructor arms `ctx.storage.setAlarm` for the next UTC
  midnight if none is set; `alarm()` rearms for the following day _before_ resetting the board, not
  after — if `reset()` were to throw, rearming first means the object only misses one day's reset
  rather than never rearming again. This is real wall-clock time, deliberately not `workspace.now`
  — the frozen demo clock stays frozen for the scripted scenarios, and the alarm is infrastructure,
  not workspace data. Manual reset (the `POST /api/workspace/reset` route, and the Reset demo button
  in the header per [wireframes.md](../wireframes.md) §1) is untouched and does not reschedule the
  alarm; the two are independent, so the daily boundary stays predictable regardless of how often
  someone resets by hand.
- **A persisted approval ledger.** `spentApprovals` was an in-memory `Set` in the Worker — per
  isolate, so it bounded replay within one isolate rather than globally, exactly the gap
  [ADR-0010](0010-tool-approval-mechanism-and-replay-protection.md) flagged as future work. It now
  lives in the same Durable Object as the board, behind `WorkspaceApi.spendApprovals`, and
  `settleApprovals` calls it instead of touching module state.
- **Reset clears both.** A fresh board and a fresh ledger together, on the theory that both
  represent "start the demo over." The trade-off is real, not cosmetic: the seed is fully
  deterministic, so DS-7 after a reset is the same DS-7 a captured approval named before it —
  clearing the ledger means that approval could replay once more and reapply an equivalent write,
  not a no-op against discarded ids. Accepted anyway: this is a demo board with nothing at stake in
  the difference, and a ledger that outlived the board it was protecting would keep denying
  approvals against issues and deployments reset back to a shape they no longer match. A real
  deployment would want the ledger scoped to something a reset does not touch.

## Consequences

- Positive: replay protection is real now, not "real within whichever isolate handled the request" —
  with two named exceptions rather than none: reset clears it, and it evicts the oldest entries past
  1,500 to stay under the storage backend's per-value limit. Neither is "single-use" in
  the unconditional sense the interface comment on `spendApprovals` might otherwise suggest; both are
  bounded, documented trade-offs for a demo board, not gaps nobody noticed.
- Positive: the demo resets itself. A recruiter opening the link after everyone else's exploring
  during the day sees a fresh board without anyone having to remember to hit Reset.
- Positive: S-F's "same workspace, two clients" stays true, because nothing about who is asking
  changes which object the request lands in.
- Positive: the Phase 6 comment that was quietly wrong is now quietly right — worth calling out only
  because it shipped as if it were a settled plan, and this ADR is what makes it not one anymore.
- Negative: the site remains genuinely multi-tenant-unsafe — two people exploring the live demo
  concurrently see each other's chat side effects on the shared board, and either's Reset discards
  the other's. Acceptable per the product brief's own non-goal; worth restating here because it is
  the direct cost of this decision, not a pre-existing given.
- Negative: `WorkspaceDO`'s own storage behaviour — the alarm firing, the ledger surviving a
  restart — cannot be driven through `createLocalWorkspaceApi`, the in-memory stand-in the rest of
  the suite tests against, because it is not domain logic. A hand-built fake
  `DurableObjectState` (`apps/api/test/durable-object-state.ts`) covers it directly instead, closing
  the gap ADR-0011 left open rather than leaving it to "the live smoke."
- Negative: alarms cannot be driven from outside; nothing here proves the alarm actually fires 24
  hours later against deployed Cloudflare, only that the object arms one correctly and that firing
  it behaves correctly. That is what the live deploy in Phase 14 is for.

## Alternatives Considered

- **Per-visitor session isolation, as anticipated** — rejected on the conflict above: it costs
  either S-F or the non-goal, for a benefit (protecting concurrent visitors from each other) real
  enough to name but not enough to justify rearchitecting the one thing that makes the MCP story
  demonstrable.
- **D1 for the ledger, pulled from the original Phase 9 line** — rejected for the same reason
  ADR-0011 rejected it for the workspace: one more moving part, one more thing to keep consistent
  with the object that already holds everything else, for no capability the object doesn't already
  have.
- **A Workers Cron Trigger for the reset instead of a DO alarm** — rejected: a cron trigger fires
  the Worker, not a specific object, so it would still need to look up and call the same DO — more
  configuration than `ctx.storage.setAlarm` for an identical result, and one more thing Phase 14's
  deploy topology would have to wire up per environment.
- **Reset the board but keep the ledger** — considered and rejected in favour of clearing both: a
  ledger that outlives the board it was protecting would keep denying approvals against issues and
  deployments that no longer exist in that shape, for a demo where nothing is actually at stake in
  the alternative.

## References

- [docs/product-brief.md](../product-brief.md) — "Auth / multi-tenancy" as a non-goal; success
  criterion 2, "the same workspace"
- [docs/demo-scenarios.md](../demo-scenarios.md) — S-F, "same workspace, two clients"
- [ADR-0010](0010-tool-approval-mechanism-and-replay-protection.md) — the replay guard this
  persists
- [ADR-0011](0011-workspace-state-in-a-durable-object.md) — the Durable Object this alarm and
  ledger live in
- [docs/roadmap.md](../roadmap.md) — Phase 9

## Status note — 2026-10-22

The deploy this ADR waited for happened on 2026-10-21, but whether the alarm fired at the next UTC
midnight is **still unverified**. The board was also reset by hand several times that day, which
would mask it, and nothing in the repo records an alarm firing in production. To check it, watch
`wrangler tail devsprint-api` across a midnight, or look for the reset in Workers Observability,
and record the result here.

## Status note — 2026-10-25

The SPA still does not poll, which is the reading of this ADR's shared board that the S-F browser
spec cited. What changed is when it re-reads:

- **It re-reads the board when the reader returns to the tab,** on window focus or on the page
  turning visible, at most once every 5 seconds and never while a chat turn streams (it already
  re-read when a turn settles). Writes made by another visitor or an outside MCP host now show up,
  marked like an approved move, when the reviewer switches back, without a reload; the S-F spec
  steps the page's clock and focuses the window instead of reloading. Nothing runs while the tab is
  away (`apps/web/src/features/workspace/composables/useReadOnReturn.ts`).
- **The board says when it was last read** ("Updated 2 min ago" beside a "Live board" badge, which
  was "live" and read as the sprint's state), so a board another visitor left mid-state is
  recognisable as current.
- **Reset board asks "Reset for everyone?" first,** inline, because of the cost named under
  Consequences above: either visitor's Reset discards the other's work.
