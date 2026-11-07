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
