# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-07-08
- Deciders: repo owner (solo project)

## Context and Problem Statement

DevSprint Copilot is a portfolio project whose real audience is senior reviewers evaluating
architectural judgment, not just working code. The roadmap spans phases 0-15 and contains several
deliberate bets that will look arbitrary later without a written rationale: staged MCP adoption,
approval-gate mechanics on a churning SDK API, free-tier model routing, and a deferred Vapor Mode
experiment. Decisions made in Phase 0 will be revisited months later, often after the surrounding
ecosystem has moved. We need a decision record that is cheap enough to actually keep, lives in the
repo, and renders on GitHub without tooling.

## Decision

We will record every architecturally significant decision as a MADR-lite markdown file in
`docs/adr/`, numbered sequentially from 0001, using [template.md](template.md). No `adr-tools` CLI
or generator is used.

## Consequences

- Positive: reviewers can audit the "why" directly instead of reverse-engineering it from commits.
- Positive: zero tooling — plain markdown files that render on GitHub as-is.
- Positive: superseding (rather than editing) accepted ADRs preserves the decision timeline.
- Negative: numbering, formatting, and index upkeep rely on discipline, not a CLI.
- Negative: ADRs can silently drift from code on a pivot; the index in
  [README.md](README.md) must be updated in the same commit as any stance change.

## Alternatives Considered

- `adr-tools` CLI — rejected: adds a dependency for what a template file already solves.
- Decisions recorded only in commit messages / PR descriptions — rejected: not discoverable, no
  single index, unreadable as a narrative.
- External wiki or Notion — rejected: splits documentation from the code and dies with the demo.

## References

- [docs/README.md](../README.md) — docs index
- MADR format (madr.github.io) — the "lite" subset used here
