# ADR-0024: Harden the shared board against one anonymous client

- Status: Accepted
- Date: 2026-10-29
- Deciders: repo owner (solo project)

## Context and Problem Statement

A security audit on 2026-10-26 (kept out of the repo) found three ways one anonymous client could
make the demo unusable for every visitor. None needed a bug, only the open design (ADR-0014,
ADR-0020) used faster than a person would use it:

- **SEC-01.** Reset, undo and deployment cancel had no rate limit. A `curl` loop on reset kept the
  board at its seed and wiped every approved write as it landed. Cancel took any deployment id,
  and `GET /api/workspace` lists them all, so anyone could stop anyone's run.
- **SEC-02.** The SDK dispatches every element of a JSON-RPC batch, and ADR-0020's limit spends one
  token per HTTP request. So one request could carry a hundred `create_issue` calls.
- **SEC-03.** The 512 KB board cap counts serialized JSON, where a control character is a
  six-character escape. About 17 maximal public creates filled the board, after which every write
  (status changes and reassignments included) failed for everyone. Even plain text filled it in
  about 100 creates. That is minutes, not ADR-0020's "tens of minutes per IP".

The question is how to close those gaps without accounts. Multi-tenancy is a non-goal, and an
external MCP host has to keep landing on the same board (ADR-0014).

## Decision

We will protect what other visitors depend on in the Durable Object, where it holds globally, and
use per-IP limits only to slow a script down:

- **Reset has a whole-board cooldown.** `requestReset` refuses a visitor's reset within 30 s of the
  last one (`RESET_COOLDOWN`, HTTP 429). The value comes from `RESET_COOLDOWN_SECONDS`, which the
  e2e stack sets to 0. The daily alarm still calls `reset` directly.
- **Cancel needs the run's token.** `startDeployment` mints a random token. The token is stored
  beside the board, never on it, and rides on every `run_deployment` stream frame. The cancel
  route takes `{ cancelToken }`, and a wrong or missing token is answered like an unknown id. A
  reset drops every token, so a stale one can't stop a new run that reuses its id.
- **Undo and cancel share a per-IP limit** of 30 a minute (`WRITE_RATE_LIMIT`). Reset is left to
  its cooldown, which is stricter, and per-IP limiting would also throttle the e2e suite, which
  resets before every test.
- **The public `/mcp` refuses JSON-RPC batches** with `-32600`. The MCP spec dropped batching in
  2025-06-18. The `Internal` entrypoint is unchanged.
- **Stored text can't contain C0 control characters (other than tab, newline and carriage return)
  or lone surrogates.** Every write schema refuses them.
- **A day can add at most 40 issues to the seed.** The 41st `create_issue` gets `WORKSPACE_FULL`.
  At the costliest text the schemas allow, 40 issues stay well under the byte cap. So a flood
  stops new issues and nothing else.

## Consequences

- Positive: no single client can wipe other visitors' writes, stop their deploys, or lock every
  write on the board. The worst a flood can now do is use up the day's 40 new issues.
- Positive: each of the three protections holds across isolates and Cloudflare locations, because
  it lives in the Durable Object.
- Negative: an issue flood still blocks new issues for everyone until a reset or midnight. Reset
  remains the remedy, and the cooldown only rate-limits it.
- Negative: a visitor who resets seconds after someone else is refused. The board is already fresh
  in that case, so little is lost.
- Negative: the cancel token reaches the model with the rest of the tool output. It grants nothing
  beyond what that visitor's own Cancel button already can.

## Alternatives Considered

- **Random deployment ids instead of a token:** the board lists every id, so randomness alone
  protects nothing.
- **A per-IP reset limit only:** a reset loop from a handful of addresses still wipes the board
  continuously. The cooldown has to be global.
- **Charging one rate-limit token per batch element:** that keeps a feature no MCP host uses.
- **A per-client create quota in the Durable Object:** fairer, but it needs a client key the
  workspace API doesn't have, and the board resets daily anyway.

## References

- The 2026-10-26 security audit, findings SEC-01, SEC-02 and SEC-03 (not committed)
- [ADR-0013](0013-deployment-cancel-as-an-api-route.md): the cancel route, now token-bound
- [ADR-0020](0020-rate-limit-the-public-mcp-endpoint.md): its "tens of minutes" figure and its
  rejection of an issue-count cap are corrected here
- `apps/api/src/workspace/durable-object.ts`, `apps/api/src/index.ts`,
  `apps/mcp-issues/src/batch.ts`, `packages/shared/src/tools/schemas.ts`

## Status note — 2026-11-01

Reading the body whole to spot a batch left that read unbounded, and the SDK's own
`maxRequestBodySize` is skipped once a body is handed to the transport. So `refuseBatch` now stops
reading at 64 KB and answers 413, for a declared `Content-Length` and for a chunked body that
declares none. The transport has the same limit for the `Internal` entrypoint, which it reads for
itself. Both entrypoints also set the SDK's `maxToolInputElements` to 100, and zod moved to a version
that reports an oversized array once rather than once per element. The 413 comes after the
rate-limit token is spent, which keeps ADR-0020's order.

The first Positive line overstates the cooldown when it says no single client can wipe other
visitors' writes. One client can still reset the board every 30 seconds, and a write landed before
that reset is gone. What the cooldown stops is a loop that keeps the board at its seed. Since
ADR-0025 a browser page on another origin can't send that reset from its visitors' browsers, but
curl still can, because the board stays public (ADR-0014).

## Status note — 2026-11-02

The rejected per-client create quota gave as one reason that the workspace API has no client key. It
has one now, on the spend path only: `modelUsage` and `recordModelUsage` take a key the object stores
hashed (ADR-0016's status note of this date). That reversal is for model spend, where one client could
take the whole day from everyone. Board writes still carry no key and the create quota stays unbuilt,
because the board resets daily and 40 new issues a day already bounds a flood.

## Status note — 2026-11-07

"A day can add at most 40 issues" and "40 new issues a day" describe the limit loosely. The check
counts the issues on the board above the seed, not creates in a day: undoing a create frees its
slot, and a reset, by the midnight alarm or by anyone pressing Reset, clears all 40. So the limit
holds until the board resets, which can happen more than once a day. The `WORKSPACE_FULL` message,
the comment on `MAX_CREATED_ISSUES`, docs/tool-inventory.md and docs/domain-model.md now say so.
The slots are also shared by every path that creates issues, the in-app agent included, so while
the board is full the agent cannot create one either until a reset.

Undo and cancel now bound their bodies too, as the 2026-11-01 note did for the MCP batch check.
Each body carries one id, so the limit is 4 KB (`MAX_BOARD_WRITE_BODY_BYTES`), not chat's 256 KiB.
Past it, either route answers 413 in its `{ ok: false, error }` envelope, for a declared
`Content-Length` and for a chunked body alike. The limit runs after `WRITE_RATE_LIMIT`, so an
oversized request still spends its token. A change id, cancel token or deployment id longer than 64
characters (`MAX_BOARD_WRITE_ID_LENGTH`) is refused as `INVALID_INPUT` before the request reaches the
Durable Object. Every id these routes take is server-minted and shorter than that, so the SPA's
requests, a few dozen bytes each, are unaffected.

## Status note — 2026-11-08

`GET /api/workspace`, the board snapshot, had no rate limit, and every read is a Durable Object
call. It now has a per-IP limit of 300 a minute (`READ_RATE_LIMIT`). A throttled read gets 429
with `Retry-After: 60`, in the same `{ ok: false, error }` envelope as undo and cancel. The SPA
does not poll: a tab reads on load, after a turn, a Reset or a Cancel, and on a return to the
tab at most once every 5 seconds. That is about a dozen reads a minute from one busy tab, so 300
leaves room for many tabs, or several visitors behind one address. Like the other limits, an
absent binding means no limit, and a request with no client IP is not limited. The write limit
and the read limit now come from one middleware factory, so they can't drift apart.

A refused reset no longer always reaches the Durable Object either. Each isolate keeps a lower
bound on when the next reset is allowed, learned from the object's own answers. An accepted reset
happened no earlier than the request was sent, and a refusal of `n` seconds leaves more than
`n - 1`. Within that bound the Worker answers with the same `RESET_COOLDOWN` refusal itself. Its
`Retry-After` can be a little shorter than the object's figure, never longer. The object stays the
source of truth: past the bound, or after a reset made through another isolate, the request goes
to the object as before. With no cooldown configured, the e2e case, nothing is kept.

Both limits stop a loop from turning into Durable Object calls. Neither saves the account's
request quota: a request the Worker refuses still runs the Worker and counts as a request. Only a
rate-limiting rule at the edge, on a zone in front of the Worker, refuses a request before that.
The api is served on workers.dev (ADR-0019), so that would also mean moving it to a custom domain.
Both are account-level decisions outside this repository.

The 2026-11-07 note's last point is now narrower. MCP clients alone could take all 40 slots, and
then the in-app copilot could not create an issue until a reset. So the 40 now has a share for the
public MCP endpoint:

- **Issues carry where they came from.** An issue created through the public entrypoint of
  `apps/mcp-issues` is stored with `source: 'mcp'`. The entrypoint sets it, not the tool's
  arguments, which the schema strips of unknown fields anyway. The in-app agent's `Internal`
  entrypoint and the local fallback store no `source`, and an issue without one reads as in-app,
  so boards stored before this change read the same. The SPA shows a "via MCP" badge on those
  cards, in words, so it reads without colour.
- **At most 20 of the 40 may be marked `mcp`** (`MAX_MCP_CREATED_ISSUES`). Past that, an MCP
  `create_issue` gets `WORKSPACE_FULL` with a message that names the MCP share and says reads,
  moves and reassignments still work. The copilot keeps the other 20. The share counts the issues
  on the board, as the main cap does, so a reset or an undo frees it too.

This is a per-path quota, not the per-client one rejected above. It still needs no client key, and
one MCP client can still use the whole MCP share for every other MCP client until a reset.
