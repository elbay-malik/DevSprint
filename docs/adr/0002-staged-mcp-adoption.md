# ADR-0002: Staged MCP adoption

- Status: Accepted
- Date: 2026-07-08
- Deciders: repo owner (solo project)

## Context and Problem Statement

MCP is the portfolio differentiator for this project: the goal is a bidirectional story where our
backend consumes our own MCP servers as a client and one of those servers is publicly exposed so an
external host (Claude Desktop or Cursor, scenario S-F) can operate the same workspace. Starting
MCP-first, however, means fighting transport, session, and spec churn before a working agent loop
exists at all. Plain AI SDK v6 function calling gets all 10 tools from
[tool-inventory.md](../tool-inventory.md) running against deterministic fixtures quickly, and the
`{ ok, data | error }` envelope in [domain-model.md](../domain-model.md) is transport-agnostic, so
moving the same tools behind MCP later is a refactor, not a rewrite.

## Decision

We will implement tools as plain AI SDK v6 function calls for Phases 3-5, then refactor them behind
2-3 custom MCP servers on Workers at Phase 6 — the backend becoming an MCP client via `@ai-sdk/mcp`
over Streamable HTTP, with the issues server publicly exposed. Tool definitions are vendored
(`mcp-to-ai-sdk`) rather than fetched dynamically, for stability.

## Consequences

- Positive: a working agent demo exists early; MCP risk is isolated to one phase.
- Positive: the bidirectional MCP story (our client + our public server) lands intact as the
  differentiator, with workspace paths `apps/mcp-issues`, `apps/mcp-deploys`, and
  `apps/mcp-analytics` already reserved (not scaffolded until Phase 6, per ADR-0007).
- Positive: tool contracts stay stable across the migration because the result envelope is defined
  independently of transport.
- Negative: Phase 6 carries a real refactor cost and is flagged RISKY in the roadmap.
- Negative: the public issues server needs its own hardening (rate limits, input validation)
  beyond what the in-app path requires.

## Alternatives Considered

- MCP-first from Phase 3 — rejected: transport and session churn before a working agent exists.
- Plain function calling forever — rejected: loses the portfolio differentiator entirely.
- Third-party MCP framework as the only abstraction — rejected: hides the client/server plumbing
  the project is meant to showcase.

## References

- [docs/tool-inventory.md](../tool-inventory.md) — the 10 tools and their future MCP server mapping
- [docs/demo-scenarios.md](../demo-scenarios.md) — scenario S-F (external MCP host)
- [ADR-0007](0007-monorepo-pnpm-workspaces.md) — reserved `apps/mcp-*` workspace paths

## Status note — 2026-10-22 (Phase 15)

The staging happened, smaller than planned:

- **One MCP server, not two or three.** Phase 6 built a single server, `apps/mcp-issues`, with the
  four issue tools. It has been public since 2026-10-21 at
  `https://devsprint-mcp-issues.eleo-666.workers.dev/mcp` (ADR-0019). The deploys and analytics
  servers were never built, so those six tools remain plain function calls in `apps/api`.
- **Vendoring held, the tool did not.** Tool definitions are vendored from our own zod schemas, not
  through `mcp-to-ai-sdk`, which targets the previous AI SDK major (`apps/api/src/agent/mcp-tools.ts`).
- **The shared workspace came from ADR-0011.**
- **The hardening this ADR anticipated is incomplete.** The public server caps input sizes, but it
  has **no per-IP rate limit**: ADR-0016's limit covers `/api/chat` only. It also runs
  `create_issue` without an approval gate of ours, because the host owns that prompt. This is an
  open gap, not a closed one.
