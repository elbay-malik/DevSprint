# ADR-0017: Accessibility gated across states by axe, not by a Lighthouse score

- Status: Accepted
- Date: 2026-10-21
- Deciders: repo owner (solo project)

## Context and Problem Statement

Phase 12's acceptance line is "Lighthouse ≥ 95". Measured before any change (Lighthouse 13.5,
production build, api running), the SPA scored 93 / 100 / 100 / 82 on mobile — performance,
accessibility, best practices, SEO — and 100 / 100 / 100 / 82 on desktop. The performance gap was
a three-hop chain in front of first paint: the app stylesheet `@import`ed Google Fonts, whose
stylesheet then fetched the woff2, about 0.8 s of render-blocking on mobile. SEO lost points for a
missing meta description and for `/robots.txt` falling through to the SPA's `index.html`.

The accessibility 100 was the misleading number. Lighthouse audits one state: the first paint,
with an empty transcript. Everything the product actually is — issue tables, the burndown chart,
approval cards, the deployment card, and the whole dark palette — is never on screen when it
looks. Running axe-core against those states found three WCAG 2.2 AA violations the 100 had
hidden:

- `scrollable-region-focusable` in every state: the board pane scrolls on its own and holds
  nothing focusable, so a keyboard user could not reach its lower columns at all.
- `color-contrast` in the light theme: the success green (`emerald-600`, about 3.8:1 on white) on
  `text-xs` labels in the tool chip and the release-notes diff.
- `target-size` on the tool chip's `<summary>` rows, which were 16 px tall.

So the question is what the phase's gate should actually be.

## Decision

Two gates, each doing what it is reliable at:

- **Accessibility is gated in CI by `apps/web/e2e/a11y.spec.ts`.** It drives the scripted model
  into five states — empty shell, chart and table, release notes with tool chips, pending then
  answered approvals, a deployment mid-run then finished — and runs axe for WCAG 2.0/2.1/2.2 A and
  AA in each, under both `prefers-color-scheme` values. It asserts that the dark run really is
  dark, because a theme that ignored the emulated preference would audit the light palette twice
  and pass.
- **The Lighthouse line is a local, repeatable script** (`pnpm --filter @devsprint/web
lighthouse`): the median of three runs per preset, every category, failing below 90. The roadmap's original line was ≥ 95; the gate
  is set at 90 so a run on a slower machine or a busier afternoon does not fail on throttling
  noise, while the measured scores still clear 95 with room to spare. After
  self-hosting Geist, adding the description and a real `robots.txt`, it reads 98 / 100 / 100 /
  100 on mobile and 100 across the board on desktop.

Lighthouse stays out of CI deliberately. Its simulated-throttling performance score moves by
several points between identical runs on shared runners, and a hard threshold that fails on noise
is one people learn to re-run until it is green. The script retries exactly one failure mode —
`NO_FCP`, where headless Chrome never painted and so nothing was measured — and never a low score.

Adding a second spec that resets the board exposed that the e2e suite had only been safe by
accident: one file reset the shared workspace (ADR-0014), and tests within a file run serially.
With two such files in parallel workers, one wiped the other's deployment mid-run. Playwright now
runs with `workers: 1`.

## Consequences

- Positive: the accessibility claim covers the cards, gates and both themes, not an empty page,
  and a regression in any of them fails CI.
- Positive: the font is same-origin and fingerprinted, which also removes a third-party request
  from every visit.
- Negative: e2e is serial, about 1.1 minutes locally instead of under one. Per-test isolated
  workspaces would restore parallelism, but per-visitor state is the thing ADR-0014 declined.
- Negative: the Lighthouse number is only as current as the last time someone ran the script; it
  is not enforced on every push.
- Neutral: axe is automated checking, which catches perhaps a third of real accessibility
  problems. Screen-reader and keyboard walkthroughs remain manual.

## Alternatives Considered

- Lighthouse CI (`@lhci/cli`) as a hard CI gate — rejected for the noise above; asserting only the
  deterministic categories in CI would duplicate the axe spec with less coverage.
- Treating the Lighthouse accessibility 100 as done — rejected: it missed every violation axe found.
- Keeping Google Fonts with `preconnect` hints — rejected: it shortens the chain but keeps a
  third-party hop and a cross-origin request on the critical path; self-hosting removes both.
- Splitting the 272 kB `HomeView` chunk, which Lighthouse flags as 75% unused at load — deferred:
  the bulk is the AI SDK client the composer needs immediately, the cards are about 30 kB of
  source, and performance already clears the bar.

## References

- [ADR-0008](0008-vapor-mode-deferred.md) — the other half of Phase 12, whose gate was checked and
  not met
- [ADR-0014](0014-daily-reset-alarm-and-a-persisted-approval-ledger.md) — the single shared
  workspace that makes the e2e suite serial
- [docs/roadmap.md](../roadmap.md) — Phase 12

## Correction — 2026-10-21 (Phase 14)

The scores above were not measured against "the production build with the api running", as the
context section says. That build had no `VITE_API_URL`, so its board fetch went to the preview
server, failed quietly, and fell back to seed data. Measured against the deployed site (ADR-0019),
which really does talk to its api, Lighthouse scores 100 / 100 / 100 / 100 on both mobile and
desktop, median of three runs. The `lighthouse` script now targets the live URL by default.
Separately, the intermittent `NO_FCP` this ADR retried around was an incompatibility between
Lighthouse 13.5 and Playwright 1.61's Chromium. Against the live site it failed every time, and it
went away with Playwright 1.64.0.
