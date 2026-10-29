# ADR-0020: Rate-limit the public MCP endpoint, and give the agent its own way in

- Status: Accepted (amended by ADR-0024)
- Date: 2026-10-22
- Deciders: repo owner (solo project)

## Context and Problem Statement

The public MCP server runs `create_issue` with no approval gate of ours. The MCP host owns that
prompt (ADR-0016), so any client can call it in a loop. Storage was already bounded: the workspace
Durable Object refuses any write that would take the board past 512 KB (`WORKSPACE_FULL`,
`apps/api/src/workspace/durable-object.ts`). But a loop could still **fill** the board to that cap
in seconds. After that, every visitor's writes fail until the midnight reset.

ADR-0016's per-IP limit covers `/api/chat` only. The Phase 15 ADR audit named the MCP gap.
(Its first notes also wrongly said nothing capped the board; the byte cap does. The notes are
corrected below.)

The obvious fix, the same limit on the MCP Worker's `fetch`, has a catch. The in-app agent reaches
that same handler through apps/api's service binding. A binding request carries no client IP, so
either it escapes the limit by accident, or every visitor's turns share one bucket and the demo
throttles itself.

## Decision

- **The public `/mcp` endpoint is limited to 30 requests a minute per client IP,** through a
  `MCP_RATE_LIMIT` binding. That is several times what a host uses in a session, and it turns
  filling the board from a matter of seconds into tens of minutes per IP. Clients without
  `CF-Connecting-IP` are not limited rather than lumped together, the same policy as ADR-0016.
  A throttled request gets HTTP 429 with `Retry-After`, and a JSON-RPC error a host can show.
- **The agent comes in through a named entrypoint, `Internal`,** which the api's service binding
  targets (`"entrypoint": "Internal"`). It serves the same handler with no limit. It can't be
  reached from the internet: only a binding in this account can name it. The exemption is then
  explicit, not a side effect of a missing header.

Verified locally: 30 requests answered 200, then 429. With that client's bucket exhausted, chat
turns still sourced their tools over MCP (`X-DevSprint-Tools: mcp`).

## Consequences

- Positive: one client can no longer fill the shared board in seconds, and the app cannot
  throttle itself.
- Negative: the binding is per Cloudflare location and eventually consistent (ADR-0016), so a
  distributed client still gets more than 30 a minute in total. The byte cap remains the
  backstop, and Reset remains the remedy.
- Neutral: `wrangler types` now runs with `--strict-vars=false`, because committed vars such as
  `MODEL_PROVIDER` would otherwise be typed as their current literal value.

## Alternatives Considered

- **Exempt binding traffic because it lacks `CF-Connecting-IP`:** that works today, but by
  accident. Nothing promises a binding request stays header-free.
- **A shared secret header from the api:** a secret to rotate, guarding something the platform
  already scopes.
- **An issue-count cap:** redundant next to the byte cap, which already bounds storage. The
  problem was speed, not size.

Status note 2026-10-29: the "tens of minutes per IP" figure was wrong. Control characters
serialize as six-character escapes, so about 17 creates filled the board, and JSON-RPC batches put
many calls on one token. ADR-0024 refuses both, and adds the issue-count cap rejected above: the
problem turned out to be size after all.

## References

- [ADR-0016](0016-two-spend-controls-and-an-honest-injection-posture.md): the chat limit this
  mirrors
- [ADR-0019](0019-deploy-topology-and-spa-only-previews.md): the service binding and deploy order
- `apps/mcp-issues/src/limit.ts`, `apps/mcp-issues/src/index.ts`
