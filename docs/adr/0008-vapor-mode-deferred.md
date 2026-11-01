# ADR-0008: Vapor Mode deferred

- Status: Accepted (decision to defer; the experiment itself is deferred to Phase 12 — gate checked
  2026-10-21, not met)
- Date: 2026-07-08
- Deciders: repo owner (solo project)

## Context and Problem Statement

The SPA is built on Vue 3 (3.6-track): Vue 3.5.39 is what actually ships today, while 3.6 — the
line that carries Vapor Mode — is still in beta. Vapor is feature-complete but unstable on that
beta line: `<Suspense>` is not supported in Vapor components, and ecosystem catch-up (including
Reka UI, which shadcn-vue sits on per ADR-0006) is incomplete. A portfolio demo cannot afford to
sit on a beta compiler path, but Vapor is also a cheap, well-scoped performance story worth telling
later — a chat transcript with many message rows is exactly the kind of leaf-heavy render tree
Vapor targets.

## Decision

We will build on the stable Vue 3.5 line (3.6-track via pinned catalog bumps); Vapor Mode is
deferred to a flagged Phase 12 experiment on a single leaf component (the chat message row), gated
on Vapor reaching stable and Reka UI confirming compatibility.

## Consequences

- Positive: a stable base for Reka UI v2 / shadcn-vue with no beta-compiler risk in the demo.
- Positive: the pnpm catalog pin makes the eventual 3.6-stable bump a one-line, deliberate change.
- Positive: the deferred experiment stays scoped — one flagged leaf component, easily removed.
- Negative: we forgo Vapor's memory/CPU wins for now, including on the message list where they
  would show best.
- Negative: the revisit condition must actually be checked at Phase 12 (Vapor stable AND Reka UI
  compatible), or the experiment silently never happens.

## Alternatives Considered

- Adopt Vapor now on the 3.6 beta — rejected: unstable, no `<Suspense>`, ecosystem (Reka UI)
  compatibility unconfirmed.
- Skip Vapor permanently — rejected: gives up a low-cost Phase 12 performance narrative for no
  savings.
- App-wide Vapor at Phase 12 — rejected: all-or-nothing risk; a flagged leaf component proves the
  point with a fraction of the exposure.

## References

- [ADR-0006](0006-ui-kit-shadcn-vue.md) — the Reka UI dependency that gates the experiment
- [docs/roadmap.md](../roadmap.md) — Phase 12 (a11y + performance, optional Vapor experiment)

## Revisit — 2026-10-21 (Phase 12)

The gate was checked rather than skipped, and it is not met. On npm, Vue's `latest` is 3.5.44;
the 3.6 line carrying Vapor is at `3.6.0-rc.12`, a release candidate, not stable. The experiment
therefore does not run this phase, and nothing in the app depends on it. Re-check when 3.6 reaches
`latest`, together with Reka UI's compatibility, which this ADR also requires.

## Status note — 2026-11-01

The app now ships Vue 3.5.44 rather than the 3.5.39 in the context above. The decision stands, and
3.6 remains a release candidate.
