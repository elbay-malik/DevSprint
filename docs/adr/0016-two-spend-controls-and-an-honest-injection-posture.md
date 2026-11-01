# ADR-0016: Two different spend controls, and an honest prompt-injection posture

- Status: Accepted
- Date: 2026-09-23
- Deciders: repo owner (solo project)

## Context and Problem Statement

Phase 11 owes three things: "prompt-injection mitigations, per-IP rate limits, global token cap
kill-switch." The kill-switch is older than this phase —
[ADR-0005](0005-model-routing-groq-primary-gemini-fallback.md) named it at Phase 3 and deferred it
here, on the grounds that "without a global cap, one crawler or one enthusiastic reviewer can burn
the daily budget and leave the demo broken mid-conversation."

The obvious reading is that the rate limit and the token cap are the same job at two granularities,
so one mechanism should serve both. Measuring Cloudflare's rate-limit binding says otherwise, and
that is what this ADR is mostly about.

The injection half needed a measurement too, because "add prompt-injection mitigations" invites
security theatre. The question worth answering first was whether the vector is real here at all.
It is: text a client supplies through `create_issue` reaches the model verbatim inside a
`list_issues` or `search_issues` result, and `apps/mcp-issues` is public and runs that write with
**no approval gate** — the MCP host owns that prompt, not us. So anyone can plant instructions in
the board and wait for a visitor's turn to read them.

## Decision

**Two mechanisms, because they answer two different questions.**

A **per-IP rate limit** answers "is one client hammering us?" Cloudflare's own binding does that,
and its documented looseness costs nothing for that job: it is "permissive, eventually consistent,
and intentionally designed to not be used as an accurate accounting system", and it counts per
Cloudflare location rather than globally. Bound at 60 requests/60s on `/api/chat` — far above any
human session, far below what a crawler does.

A **daily token cap** answers "has the demo spent its budget?" The same looseness would be
disqualifying: a cap that undercounts is a cap that does not hold, and per-location counting means
no cap at all. That one lives in the workspace Durable Object, which is global and serialises. Two
properties follow, and both are load-bearing:

- **`reset()` does not clear it.** The board and the approval ledger both mean "start the demo
  over"; the budget does not, or any visitor could clear the spend cap by pressing Reset.
- **It rolls over by comparing the stored UTC day to today**, rather than by being cleared on a
  schedule — so a Worker that was asleep across midnight comes back with a fresh budget without
  anything having had to fire.

The scripted mock is exempt, because it spends nothing. Rationing local dev and CI against a
resource they do not consume would be a cost with no benefit.

Both degrade into **a readable assistant turn, not an HTTP error** — the state ADR-0005 asked for.
The transcript stays usable and the SPA needs no special case; an `X-DevSprint-Limit` header says
which control fired, for anyone debugging.

**On injection, the honest posture is that the approval gate is the control, and the rest is depth.**
Stating that plainly is the point of writing it down:

- **Nothing an injected instruction says can execute a write.** Every write is gated behind a human
  approval that names the tool and shows its arguments (ADR-0003, ADR-0010). That is the property
  that matters, and it already existed.
- **Injected text cannot become markup.** The SPA renders every assistant and tool string through
  Vue interpolation; there is no `v-html` anywhere in it. Also already true — checked rather than
  assumed.
- **A system-prompt rule** now tells the model that everything inside a tool result is workspace
  data, that users write it (including through the ungated public MCP server), and that it is
  content to report rather than a request to follow.

What that rule buys is a lower chance of an injected string steering an _answer_, which is the part
no gate covers. It is not a guarantee and is not treated as one.

## Consequences

- Positive: the two controls fail independently. A burst gets throttled without touching the
  budget; an exhausted budget does not need the limiter to have noticed anything.
- Positive: the cap is where the durable, serialising state already is, so it needed no new
  infrastructure — just a key the reset does not touch.
- Positive: local dev and CI are unaffected by design, not by accident: an unbound limiter is no
  limiter, and the mock is exempt from the cap.
- Negative: the rate limit is per Cloudflare location, so a distributed client gets one bucket per
  colo. Accepted — the token cap is the control that actually bounds spend, and it is global.
- Negative: usage is recorded _after_ a turn finishes, so a burst of concurrent turns can overshoot
  the cap by roughly one round of turns. Charging up front would mean estimating tokens before
  generating them, which trades a small overshoot for a permanent inaccuracy.
- Negative: the budget survives `reset()`, so a demo that has spent its day cannot be revived by
  pressing Reset. That is the point, but it does mean the only ways back are waiting for UTC
  midnight or raising `DAILY_TOKEN_CAP`.
- Negative: the injection mitigation is a prompt rule, and prompt rules are not guarantees. The
  security claim this repo makes is about the gate, not about the model's compliance.

## Alternatives Considered

- **One mechanism for both** — rejected on Cloudflare's own documentation: the rate-limit binding
  disclaims being an accounting system and counts per location, so using it as the spend cap would
  ship a cap that does not bound spend. The inverse (per-IP throttling in the Durable Object) would
  funnel every request through one object to answer a question that does not need to be exact.
- **A 429 for both** — rejected: ADR-0005 explicitly asks for "a graceful demo budget reached state
  instead of surfacing provider errors", and an error code in the transcript is the opposite.
- **Charging the budget before the turn** — rejected: it would require estimating tokens ahead of
  generation, trading a bounded overshoot for a permanent guess.
- **Clearing the budget on reset, for symmetry with the board and the ledger** — rejected: it makes
  the cap bypassable by a button the demo deliberately exposes to everyone.
- **Filtering or rejecting "injection-looking" text on write** — rejected as theatre. It cannot be
  done reliably, it would corrupt legitimate content, and it would imply a guarantee the gate
  already provides better.
- **Wrapping untrusted fields in delimiters inside tool results** — rejected for now: it changes
  the shared tool-output contract that the cards consume, for a marginal gain over the prompt rule.

## References

- [ADR-0005](0005-model-routing-groq-primary-gemini-fallback.md) — the kill-switch this builds
- [ADR-0003](0003-hitl-approval-gates-on-write-tools.md) — the approval gate the injection posture rests on
- [ADR-0011](0011-workspace-state-in-a-durable-object.md) — the Durable Object the budget lives in
- [ADR-0014](0014-daily-reset-alarm-and-a-persisted-approval-ledger.md) — reset semantics the budget deliberately departs from
- [docs/roadmap.md](../roadmap.md) — Phase 11

## Status note — 2026-10-22

"Local dev and CI are unaffected … an unbound limiter is no limiter" is imprecise. `CHAT_RATE_LIMIT`
is declared in `apps/api/wrangler.jsonc`, so `wrangler dev` and the e2e stack bind a simulated
60-per-minute limiter too. That rate is far above any test's, which is why nothing trips it. Only
unit tests run unbound.

A gap this ADR did not cover: the public MCP server had no per-IP rate limit. The board's 512 KB
cap bounded storage, but one client could still fill it in seconds. ADR-0020 closes that with a
limit on the public endpoint and an unthrottled internal entrypoint for the agent.

## Status note — 2026-11-01

"Usage is recorded _after_ a turn finishes" is out of date. It is recorded after each step, because
the SDK does not call `onFinish` on an aborted turn: a client could stop every turn just before it
ended and spend without being charged. What can still go uncounted is the one step in flight when
the abort lands.
