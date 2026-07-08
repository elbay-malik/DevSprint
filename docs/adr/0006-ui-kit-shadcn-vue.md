# ADR-0006: UI kit — shadcn-vue

- Status: Accepted (user-locked)
- Date: 2026-07-08
- Deciders: repo owner (solo project); locked by explicit user preference

## Context and Problem Statement

The chat pane is built from custom in-stream components — ApprovalCard, DeploymentProgressCard,
ReleaseNotesDiff, BurndownChart, ErrorCard — that no off-the-shelf kit ships, so the UI layer must
be code we own and can edit freely. shadcn-vue's current CLI (verified July 2026) installs Reka UI
v2 primitives by default, has full Tailwind v4 support (`@theme` directive), builds its Chart
components on Unovis, and uses Sonner for toasts. The main competitor, Nuxt UI v4 (usable in a
plain Vite SPA via `@nuxt/ui/vite` plus the Vue plugin), offers faster purpose-built chat
components and Comark streaming markdown — but its components are consumed as a dependency, which
carries less code-ownership signal for a senior portfolio.

## Decision

We will use shadcn-vue as the UI kit: components are vendored into `apps/web` and edited freely,
with charts on Unovis and toasts on Sonner.

## Consequences

- Positive: every card in the registry is our own Vue/TS code — exactly the signal the portfolio
  needs.
- Positive: the Unovis-based Chart component covers BurndownChart without an extra chart
  dependency.
- Negative: chat primitives (message list, composer, auto-scroll with scroll anchoring) are
  hand-built rather than inherited from a kit.
- Negative: streaming markdown rendering has no Comark equivalent in this stack — evaluate one at
  Phase 7.
- Negative: Tailwind v4 and Reka UI v2 are still young; pin versions and upgrade deliberately.

## Alternatives Considered

- Nuxt UI v4 — rejected: faster chat scaffolding but weaker code-ownership signal; kept in mind as
  the benchmark for chat UX quality.
- PrimeVue / Vuetify — rejected: heavyweight theming systems and the wrong aesthetic for a
  developer-tool demo.
- Hand-rolled CSS with headless primitives only — rejected: a time sink with no reviewer-visible
  upside over vendored shadcn-vue components.

## References

- [docs/wireframes.md](../wireframes.md) — Section 5, component registry
- https://www.shadcn-vue.com/docs/changelog — Reka UI v2 + Tailwind v4 support
- https://www.shadcn-vue.com/docs/components/chart — Unovis-based charts
