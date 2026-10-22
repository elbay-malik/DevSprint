# ADR-0009: Workers Static Assets over Pages

- Status: Accepted for scaffold (deploy execution deferred: no Cloudflare deploy this pass; the
  wrangler config is committed deploy-ready)
- Date: 2026-07-08
- Deciders: repo owner (solo project)

## Context and Problem Statement

The SPA needs a static hosting story on Cloudflare that coexists cleanly with the `apps/api` Worker
(ADR-0004) and the future `apps/mcp-*` Workers (ADR-0007). Since reaching feature parity around
March 2026, Cloudflare recommends Workers Static Assets over Pages for new projects (per the
brief), which keeps the entire deploy topology on a single platform primitive — Workers — instead
of splitting it across Workers and Pages. This pass is local-only but deploy-ready: the config is
committed now so that turning on deploys at Phase 14 is a CI change, not a redesign.

## Decision

We will serve the SPA via Workers Static Assets as an assets-only Worker; the committed
`apps/web/wrangler.jsonc` targets exactly this shape (no Worker script, an assets binding with SPA
fallback for client-side routing). Pages remains the fallback if PR-preview ergonomics demand it —
revisit at Phase 14.

## Consequences

- Positive: one platform primitive (Workers) for SPA, API, and future MCP servers — one mental
  model, one wrangler toolchain.
- Positive: `apps/web/wrangler.jsonc` is committed deploy-ready; Phase 14 flips deploys on without
  touching the shape of the app.
- Positive: an assets-only Worker serves static requests free of Worker invocation cost, fitting
  the ≤ 5 EUR/month budget.
- Negative: Pages' built-in PR previews are lost; Phase 14 must cover previews via wrangler
  versions/preview URLs or fall back to Pages.
- Negative: much existing documentation and tutorial content still assumes Pages — minor but
  recurring friction.

## Alternatives Considered

- Cloudflare Pages — rejected for new projects per Cloudflare's own recommendation; kept as the
  Phase 14 fallback solely for PR-preview ergonomics.
- Single Worker serving SPA + API together — rejected for now: couples the UI's deploy cadence to
  the agent backend's; the Static Assets shape leaves consolidation open later.
- Netlify / Vercel for the SPA — rejected: introduces a second vendor and splits the platform
  story for no benefit.

## References

- [ADR-0004](0004-hono-on-cloudflare-workers.md) — the API Worker this shape sits alongside
- [docs/roadmap.md](../roadmap.md) — Phase 14 (CI/CD deploy topology, PR previews)
- `apps/web/wrangler.jsonc` — the committed assets-only Worker config this ADR matches

## Status note — 2026-10-22

**Deployed 2026-10-21** at `https://devsprint-web.eleo-666.workers.dev` by `pnpm deploy:all`
(ADR-0019). Pages was not needed for PR previews: a preview is a version of this Worker uploaded
with `--preview-alias pr-<n>`, running against the production api. The single-Worker consolidation
left open above was considered in ADR-0019 and declined.
