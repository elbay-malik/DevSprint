# ADR-0004: Hono on Cloudflare Workers

- Status: Accepted
- Date: 2026-07-08
- Deciders: repo owner (solo project)

## Context and Problem Statement

The agent loop must run server-side: it holds all provider keys (Groq, Gemini) and it is the only
place the approval policy of ADR-0003 can be enforced trustworthily. The budget target of
≤ 5 EUR/month (ideally 0) points at a serverless free tier, and the demo depends on first-class
response streaming (SSE / AI SDK data parts) plus simple routing and CORS handling. Cloudflare
Workers' free tier fits the cost envelope, `wrangler dev` runs the same workerd runtime locally,
and Hono is the idiomatic thin framework on that platform. This pass is local-only but
deploy-ready: the Worker's wrangler config is committed, no Cloudflare deploy happens yet.

## Decision

We will run the agent loop as a Hono application on Cloudflare Workers (`apps/api`,
`@devsprint/api`), serving `/api/chat` as a streaming endpoint to the SPA.

## Consequences

- Positive: all provider keys stay server-side; the SPA never talks to a model provider.
- Positive: local `wrangler dev` matches the production runtime, so "works locally" is meaningful.
- Positive: Hono's routing, middleware, and streaming helpers beat bare Workers ergonomics at
  near-zero framework weight.
- Negative: workerd quirks constrain observability (Phase 10 OTLP export is flagged RISKY).
- Negative: CPU-time and subrequest limits shape how the long-running deployment simulation
  (Phase 8) must be built.

## Alternatives Considered

- Cloudflare Agents SDK as the primary abstraction — rejected: hides the agent loop this project
  exists to showcase; borrow `McpAgent` / RPC pieces selectively later if useful.
- Bare Workers (no framework) — rejected: worse routing and streaming ergonomics for no benefit.
- Node server (Fly.io / VPS / containers) — rejected: standing cost and a colder ops story than a
  free-tier Worker.

## References

- [ADR-0003](0003-hitl-approval-gates-on-write-tools.md) — server-side enforcement requirement
- [ADR-0009](0009-workers-static-assets-over-pages.md) — the SPA's Workers Static Assets shape
- [docs/roadmap.md](../roadmap.md) — Phase 2 (streaming echo) and Phase 14 (deploy topology)

## Status note — 2026-10-22

Deployed at `https://devsprint-api.eleo-666.workers.dev` since 2026-10-21 (ADR-0019). The Phase 10
OTLP risk flagged above did not hold up (ADR-0015).
