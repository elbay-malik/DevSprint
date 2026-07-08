# ADR-0007: Monorepo with pnpm workspaces

- Status: Accepted
- Date: 2026-07-08
- Deciders: repo owner (solo project)

## Context and Problem Statement

The project produces tightly coupled artifacts: a Vue SPA, a Hono Worker, and a shared package of
domain types plus seed fixtures generated verbatim from [domain-model.md](../domain-model.md).
Types must flow between them with zero drift — a fixture change that breaks a tool signature should
fail the build immediately, not surface at demo time. At Phase 6, 2-3 MCP server Workers join the
same codebase and need the same shared types. This is a solo project on one machine; pnpm via
corepack is the house standard, and polyrepo coordination overhead would buy nothing.

## Decision

We will use a single repo with pnpm workspaces via corepack (`packageManager` field +
`.node-version`): `apps/web` (`@devsprint/web`, the SPA), `apps/api` (`@devsprint/api`, the
Worker), and `packages/shared` (`@devsprint/shared`, domain types + seed fixtures). The paths
`apps/mcp-issues`, `apps/mcp-deploys`, and `apps/mcp-analytics` are reserved for Phase 6 and are
not scaffolded in this pass.

## Consequences

- Positive: a type change in `packages/shared` propagates to web and api in the same typecheck.
- Positive: one lockfile, one CI pipeline, atomic cross-package commits.
- Positive: the reserved `apps/mcp-*` paths make the Phase 6 topology legible today without
  shipping empty packages.
- Negative: workspace plumbing (catalog version pins, per-package tsconfig layering) has a real
  setup cost, paid in Phase 1.
- Negative: a single repo is a single blast radius — one broken package reddens CI for all.

## Alternatives Considered

- Polyrepo — rejected: version-sync overhead for `@devsprint/shared` with zero benefit at this
  scale.
- npm or yarn workspaces — rejected: pnpm via corepack is the established standard for this
  machine and its stricter node_modules layout catches phantom dependencies.
- Nx / Turborepo — rejected: build-orchestration weight this project does not need; pnpm's
  built-in workspace features suffice.

## References

- [ADR-0002](0002-staged-mcp-adoption.md) — why the `apps/mcp-*` paths exist at all
- [docs/domain-model.md](../domain-model.md) — the contract `packages/shared` fixtures are
  generated from
