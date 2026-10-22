# ADR-0011: Workspace state in a Durable Object

- Status: Accepted
- Date: 2026-09-05
- Deciders: repo owner (solo project)

## Context and Problem Statement

Until Phase 6 the workspace was a module singleton inside `apps/api`, which was fine while one
Worker owned every read and write. The public issues MCP server breaks that assumption. Scenario
S-F's success criterion is explicit — "the write performed in the external host is visible in the
SPA's workspace pane (same workspace, two clients)" — and separate Workers do not share memory.

[ADR-0002](0002-staged-mcp-adoption.md) commits to MCP servers as their own Workers, and
[roadmap.md](../roadmap.md) Phase 14 to one Worker per MCP server, so co-locating the server to
dodge the problem would trade the topology away. Phase 9, not Phase 6, is where persistence was
scheduled, so any answer here arrives early.

Two candidates were measured rather than argued. Sharing a D1 database between two local
`wrangler dev` processes needs a shared `--persist-to` and threw `D1_ERROR: internal error` 8 times
in 50 concurrent writes. A Durable Object bound cross-script worked first time, locally, with no
Cloudflare account, and lost nothing under the same load.

## Decision

We will keep the whole `Workspace` in a Durable Object defined in `apps/api`, and bind it
cross-script from every other Worker. We will not adopt D1 as well; there is one source of truth.

The MCP servers stay stateless. Cloudflare's current guidance is to build stateless Streamable HTTP
servers rather than session-backed ones, so the Durable Object here holds _our workspace_, never MCP
session state. Conflating the two is the trap this decision exists to avoid.

## Consequences

- Positive: S-F passes locally and when deployed, and it was verified end to end — an MCP client
  created DS-14 through the issues server and the api Worker's board showed it.
- Positive: allocating the next `DS-<n>` key is a read-modify-write, and a Durable Object serialises
  calls, so two clients filing an issue at once cannot both claim DS-14. That stops being
  theoretical the moment a second client exists, which is exactly what this phase adds.
- Positive: Phase 9 gets smaller rather than larger. Storage is built in — approved writes already
  survive a Worker restart — and `setAlarm` is the daily reset without a separate cron trigger. This
  supersedes Phase 9's D1 line. (`idFromName` becoming a per-visitor session key, floated in this
  bullet, did not happen: [ADR-0014](0014-daily-reset-alarm-and-a-persisted-approval-ledger.md)
  found it conflicts with the product brief's multi-tenancy non-goal and with this ADR's own S-F
  guarantee below. `WORKSPACE_DO_NAME` stays one fixed name.)
- Positive: the query and mutation functions are untouched. They are still pure functions over a
  snapshot; they just run inside the object now.
- Negative: local dev gains an ordering dependency. `apps/mcp-issues` resolves its binding only
  while `apps/api` is running, and a missed binding fails quietly by falling back to a _separate_
  object — a demo that looks green while proving nothing. Wrangler prints `[connected]` when the
  binding resolved, and that is worth checking before trusting a local S-F run.
- Negative: cross-script bindings resolve by deployed Worker name, so renaming `devsprint-api` or
  suffixing names for PR previews breaks them. Phase 14 owns that, and PR previews are one of its
  acceptance criteria.
- Negative: the tool layer's calls are now async and cross an RPC boundary. The unit suite drives an
  in-memory implementation of the same interface instead of a Durable Object, so the object's own
  storage behaviour is covered by the live smoke rather than by unit tests.

## Alternatives Considered

- D1, pulled forward from Phase 9 — rejected: it is most of Phase 9's work inside Phase 6's already
  risky budget, it rewrites the pure query and mutation functions into async SQL, it errored under
  concurrent local writes, and it still would not serialise the key allocation.
- Mounting the MCP routes on the existing api Worker — rejected as the destination, though it is a
  reasonable waypoint. One Worker means one module singleton locally, but a deployed Worker runs many
  isolates and an external host's request has no reason to land in the same one as the browser's.
  It also leaves the reserved `apps/mcp-*` paths empty and defers Phase 14's topology.
- The MCP server owning the state, with the api as a pure client — rejected: the workspace does not
  split. Sprint status and burndown read issues, `workspace.now` must be identical everywhere, and
  users are referenced from issues and deployments alike.

## References

- [ADR-0002](0002-staged-mcp-adoption.md) — staged MCP adoption; this is how its Phase 6 lands
- [docs/demo-scenarios.md](../demo-scenarios.md) — S-F, "same workspace, two clients"
- [docs/roadmap.md](../roadmap.md) — Phase 9 (persistence) and Phase 14 (deploy topology)

## Status note — 2026-10-22

Three statements above were forward-looking when written:

- **"S-F passes … when deployed":** first true on 2026-10-21. The first deploy's smoke check wrote an
  issue through MCP and read it back through the api (ADR-0019).
- **"Suffixing names for PR previews breaks them":** resolved by not previewing the api or the MCP
  Worker at all. Both set `preview_urls: false`, and previews are the SPA's alone (ADR-0019).
- **"Storage behaviour is covered by the live smoke rather than by unit tests":** superseded by
  ADR-0014, which added `apps/api/test/durable-object-state.ts` and unit tests for the object's
  storage.
