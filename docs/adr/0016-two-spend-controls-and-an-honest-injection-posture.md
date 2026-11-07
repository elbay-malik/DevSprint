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

The overshoot this ADR accepted is now tighter. A turn re-reads the day's usage after each tool step
and ends if the cap has been reached, so concurrent turns overshoot by about one step each rather
than one turn each. It is still not exact: the read can miss a write `waitUntil` has not landed.
Reserving tokens up front stays rejected for the reason above. A turn the check ends can finish on
a tool result with no written answer.

The request itself is bounded too, because the budget only counts what a turn has already spent:

- The body is capped at 256 KB (413), counting a chunked body as it is read. A 64 KB cap was
  considered and rejected: a transcript with tool results and a release-notes approval can pass
  that, and because the SPA resends the transcript, every later turn would be refused.
- A user message over 4,000 characters is a 400, and the composer stops at the same length.
- Older history is dropped rather than refused. The latest user message and everything after it
  always stay. Before that, a turn keeps what fits in 20 messages and 32,000 serialized characters,
  starting on a user message. The SPA sends the same range, and the server trims again because the
  transcript is client-held.
- Each model call may write at most 4,096 tokens. A release note at the 20,000-character limit does
  not fit, so its tool call would fail. Real drafts are far smaller.

**On injection, the client can no longer speak as the system.** A `system` message in the transcript
is a 400, with `allowSystemInMessages: false` on the agent behind it, because the SDK only warns by
default. A user message holding anything but text is a 400 too, which also stops the Worker fetching
a file from a URL the client chose. Provider options are removed from user parts, and left on
assistant parts because Gemini reads its thought signature back from there. Forged tool results stay
possible: the transcript is client-held, they mislead only that client's own turn, and they cannot
execute a write. A text-only message can still ask for an essay, so using the demo as a free model
is made smaller rather than impossible.

## Status note — 2026-11-02

The owner approved a per-client daily token share on 2026-11-01, and it reverses one line of the
reasoning above: that per-IP accounting in the Durable Object "would funnel every request through one
object to answer a question that does not need to be exact."

That line stays right about throttling requests, and the limiter is unchanged. It is wrong about
spend. At ADR-0021's 2,000 tokens a turn, one address at 60 turns a minute spends the day's 100,000
tokens in about a minute, and every other visitor is then told the budget is gone until midnight. A
tighter limiter does not fix that, since 20 a minute is still about 40,000 tokens a minute, and the
binding only takes a period of 10 or 60 seconds, so a longer window is not available. How much one
client has spent is an accounting question, which the binding disclaims and the object can answer. It
is not a new funnel either: a turn already reads the object for the cap and the board, and the share
is one more key on those same calls.

- **The share is 25,000 tokens a UTC day,** about 12 turns at ADR-0021's figure, from
  `CLIENT_DAILY_TOKEN_SHARE`. Unset means the default, and `0` or nonsense turns it off. It and the cap
  switch off independently.
- **The client is the rate-limit key,** so an IPv6 client is its /64. The object stores a truncated
  SHA-256 of that key and the day, never the key. That keeps addresses out of a storage dump and a
  log line. It is not anonymisation: anyone holding the map could hash every IPv4 address for the day
  and compare.
- **It follows the cap's rules.** `reset()` does not clear it, because a share a visitor can clear by
  pressing Reset is not a share. A new day ignores the old map, the next write replaces it, and the
  midnight alarm deletes it if no write comes.
- **The map holds at most 2,000 clients.** When it is full the lowest spender goes, because eviction
  hands a client a new share and the entries worth keeping are the ones near their limit.
- **It is checked where the cap is,** before approvals are spent and again between steps. A refused
  turn is a readable turn in its own words with `X-DevSprint-Limit: client-budget`, in a step of its
  own so it can't start the SPA's resend. When the day's cap is also gone, the cap's message wins.
- **A request with no client key has no share,** rather than one share between all such requests, the
  policy in ADR-0020. The day's cap still applies to it. The mock stays exempt.

What it does not do:

- **It is check-then-record.** A turn is checked, then spends, then records, so concurrent turns from
  one client can each pass the check. Overshoot of about one step per concurrent turn remains, on the
  share as on the cap. Reserving tokens up front stays rejected for the reason above.
- **It bounds one key, not one person.** Four clients with their own addresses can still spend the
  whole day between them, and a host holding a /48 has many /64s.
- **Several visitors behind one NAT share one share,** so an office can run out early. The message
  says "this connection" for that reason.
- **It does not set a header when a turn ends between steps.** The headers have gone by then, so
  `X-DevSprint-Limit` only marks a turn refused at the door. The turn still says why it ended.

Two corrections to the 2026-11-01 note, because a share any one client can reach makes both matter.

"The one step in flight" understated what could go uncounted. The SDK only reports usage for a step
that finishes, and that step can be the whole turn. A client that read the first chunk and dropped
the connection, every turn, was never charged at all: 20 such turns on a stubbed provider left the
object at 0, and neither limit fired. The limits now see it, because a model call is charged as it
starts, from the size of what is being sent, and again for each 2,000 characters it writes. The step
then settles on the provider's figure, up or down. A call the provider turns down is refunded, so a
429 costs nothing. A step that gets cut off keeps the estimate, and a step that reports no figure does
too.

That is not the reservation rejected above. The objection there was a permanent guess, and a step
that finishes still ends on the real number. Only a step with no real number keeps a rough one, which
is more accurate than the zero it replaces. A step now writes to the object about twice rather than
once, and more for a long answer. Usage can go down as well as up, through `refundModelUsage` alone,
and `recordModelUsage` still refuses a negative figure.

The estimate is only an estimate. It counts characters at four to a token, and whether a provider
bills a cancelled call in full, in part or at all has not been measured, so a client that always
leaves can be charged somewhat more or less than it cost. On the local stack a bare "hello" came to
about 2,600 tokens, since the prompt and the tool definitions go in, so a visitor who presses Stop
pays about what a turn costs. The check is still ahead of the charge, so concurrent turns can all pass
it and overshoot by about a step each.

"A turn the check ends can finish on a tool result with no written answer" is no longer true. It said
so for a once-a-day event on the cap, and the share makes it reachable by any client during its own
session. A turn a limit ends between steps now closes with that limit's message, in a step of its own
for the reason a refused turn has one. It leaves out the line about an approval not being applied,
because an approval the request carried has already run by then.

## Status note — 2026-11-07

"Provider options are removed from user parts, and left on assistant parts because Gemini reads its
thought signature back from there" is out of date. ADR-0026 removed Gemini, and Groq writes no
part-level metadata, so the reason for keeping it has gone. Provider metadata is now removed from
every part of every role: `providerMetadata` on text, reasoning, file and source parts, and
`callProviderMetadata` and `resultProviderMetadata` on tool parts. The transcript is client-held, so
whatever sat there came from the client, and the conversion would have copied it into the prompt,
where the call's estimate counts it though the provider never reads it. Approvals are unaffected:
their signature is on the approval itself, not in any metadata. If a provider that reads its own
metadata back is ever added, this needs an allowlist by provider key.

The estimate a call is charged as it starts is now capped at 12,000 tokens
(`MAX_CALL_ESTIMATE_TOKENS`), about what one call can cost on Groq's free tier: 8,000 input tokens
a minute (ADR-0021) plus the 4,096 a call may write. Counting characters overstated a large request
the provider would turn down anyway, and a call cut off before it reports keeps that charge. Output
is still charged as it is written, and a step that finishes still settles on the provider's figure.
A call larger than the cap that gets cut off is undercharged by the difference, which can only
happen on a tier with a higher per-minute limit, so the figure follows the tier.
