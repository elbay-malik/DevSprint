# ADR-0012: Burndown chart as inline SVG

- Status: Accepted
- Date: 2026-09-06
- Deciders: repo owner (solo project)

## Context and Problem Statement

[ADR-0006](0006-ui-kit-shadcn-vue.md) chose shadcn-vue "with charts on Unovis", and its consequences
say "the Unovis-based Chart component covers BurndownChart without an extra chart dependency". That
premise does not hold: shadcn-vue's Chart is a thin wrapper and Unovis is very much an extra
dependency. `@unovis/ts` is **10.7 MB unpacked**, against an entire current app bundle of **410 KB**.

The chart it would draw is two series over fourteen points, with one reference line. Phase 12 targets
Lighthouse >= 95, and [product-brief.md](../product-brief.md) rests on every card being our own code.

## Decision

We will draw BurndownChart as inline SVG in a Vue component, and not install Unovis. The rest of
ADR-0006 stands: shadcn-vue remains the UI kit, and its vendored components back everything else.

## Consequences

- Positive: no chart dependency, so the bundle stays close to what it was for a chart this small.
- Positive: full control over the things that carry the meaning here — the "today" marker at the
  fixed demo clock, the crosshair, and theming straight from the app's own tokens rather than a
  chart library's palette.
- Positive: the component is ours end to end, which is the signal ADR-0006 wanted in the first place.
- Negative: axes, ticks, hover hit-testing and the accessible table are hand-written, and a second
  chart would have to either repeat that or extract a shared primitive. If Phase 7's card set grows
  past two or three charts, revisit — a library earns its weight at that point.
- Negative: no chart library means no free interaction niceties (zoom, brush, animation). None are
  in the wireframes, so nothing is lost today.

## Alternatives Considered

- Unovis via shadcn-vue's Chart, as ADR-0006 assumed — rejected on the measurement above: 10.7 MB
  unpacked to draw 28 points.
- A small charting library instead — rejected: it still buys a dependency and a palette to override,
  for a component that is about a hundred lines of SVG.

## References

- [ADR-0006](0006-ui-kit-shadcn-vue.md) — the UI kit decision this narrows
- [docs/wireframes.md](../wireframes.md) §5 — the component registry
- [docs/roadmap.md](../roadmap.md) — Phase 7 (generative UI), Phase 12 (performance target)
