# ADR-0018: Scenario specs assert three layers, and a mutation pass checks the tests

- Status: Accepted
- Date: 2026-10-21
- Deciders: repo owner (solo project)

## Context and Problem Statement

Phase 13's line is "unit tests + Playwright E2E (driven by the 6 demo scenarios) green in CI".
Both suites were already green, so "green" was not the question. An audit mapped all 173
requirements of the six scenarios (every precondition, step, expected-UI detail and eval
assertion) to the tests that assert them, then a second pass tried to refute each mapping. Most
coverage turned out to be weak in the way this repo keeps meeting. A check passed through the
code path without asserting the value. A value was asserted only in text the scripted model
writes. A scenario's verbatim prompt was never sent in a browser at all: S-A's save step, S-E's
recovery and S-F had no browser test, and S-D's prompt was never typed.

Two eval assertions were green for the wrong reason:

- S-D's "mentions DS-11" held only because the mock's bare `/show/` match planned a stray
  `list_issues` for "Show me the burndown". The burndown series carries no issue data, so with
  that call removed the answer could not name the blocker at all.
- S-E's eval stopped after the first turn, so "a second, separate approval" and "DS-7 is done"
  were asserted nowhere.

## Decision

**One browser test per scenario (`apps/web/e2e/scenarios.spec.ts`), each asserting three layers.**
Each uses the scenario's verbatim prompts and its own eval assertions:

- **The DOM:** cards scoped by `data-issue-key`, and user and assistant messages by role, so a
  check cannot be satisfied by text from the wrong place.
- **The stream:** `recordStream` reads the AI SDK UI stream the browser received. The trajectory,
  arguments and ordering assertions (approval strictly before execution) therefore hold in the
  browser, not only in the eval harness. It also refuses any turn not served by the scripted
  model over MCP, so a reused local api running a live provider cannot pass the suite.
- **The store:** `storedWorkspace` reads the api's Durable Object, because the card and the store
  can disagree. S-F writes through `apps/mcp-issues` with the stock MCP SDK client and reads back
  through the api, so it fails if the two Workers ever stop sharing one object.

**A mutation pass checks the tests themselves.** Reviewers proposed small, realistic breaks in
product code that they predicted would survive. All ten survived the unit, eval and e2e suites
when actually applied. Among them:

- sprint stats frozen at the seed
- the ideal line drawn from the remaining series
- an inverted chart axis
- a progress bar whose width lost its `%`
- every applied write styled as a failure
- a diff baselined on an unpublished draft

Each got a unit test written against it, and re-applying each mutation now fails exactly that
test.

**Where the doc and the product disagree, the change goes to whichever side is wrong:**

- The mock now passes the step tables' exact arguments when the user names a sprint, asks S-E's
  "Did you mean DS-7 …?" question, and reads the blockers for an "on track?" question. S-D's
  table gains that read.
- An approved write that fails now gets its ErrorCard (S-E's first success criterion), and
  backlog cards show their status, so S-F's follow-up move can be seen at all.
- Unbuilt UI stays unbuilt and is now named as such: the composer buttons, the Sprint and Deploys
  tabs, the release-notes badge, markdown rendering (excluded by ADR-0016's no-`v-html` posture),
  and an "interrupted" stage state.

Smaller fixes the browser tests forced:

- the chat stream declares `charset=utf-8`; without it the DevTools protocol decoded "—" as
  Latin-1
- Playwright gets `forbidOnly` in CI and no retries, since a retry turns a load-only failure into
  a green run
- the api starts before mcp-issues
- traces are kept on failure, and CI uploads them

## Consequences

- Positive: each scenario's acceptance criteria now fail CI on the layer that broke, and the doc
  no longer claims UI that does not exist.
- Positive: the mutation pass is cheap to repeat (`mutants.json` → apply → run → restore). It
  measures whether the tests can fail, which no amount of green can show.
- Negative: e2e is longer, about 1.4 minutes serial, because each scenario runs whole and two
  deploys take real stage time.
- Negative: the stream recorder couples the specs to the AI SDK v6 UI-stream event names
  (`tool-input-available`, `tool-approval-request`). A major SDK bump will need it updated.
- Neutral: the mutation survivors were found by reviewers who guessed. A tool such as Stryker
  would be exhaustive; it was not adopted because the e2e half cannot run in parallel against one
  shared board (ADR-0017).

## Alternatives Considered

- Count green tests as Phase 13 done: rejected, because the audit showed the green suites missed
  most scenario requirements.
- DOM-only assertions: rejected, because trajectory and ordering are not visible in the DOM, and
  a card can show a state the store does not hold.
- Assert the step tables' exact arguments with `toEqual`: rejected for MCP-served reads, whose
  schema fills in defaults such as `limit`; those are matched as a subset.

## References

- [docs/demo-scenarios.md](../demo-scenarios.md): the acceptance spec, corrected here
- [ADR-0015](0015-otlp-tracing-without-the-opentelemetry-sdk.md): the trajectory evals
- [ADR-0016](0016-two-spend-controls-and-an-honest-injection-posture.md): why chat text is not
  rendered as markdown
- [ADR-0017](0017-accessibility-gated-across-states-not-by-lighthouse.md): the single-worker suite

## Status note — 2026-10-22

Corrections to this ADR as written:

- **`mutants.json` was a working file and was never committed,** so "cheap to repeat" overstated
  it. What persists is the ten unit tests, each named in commit `56f60bb`'s message for the
  mutation it kills, which keeps the pass reproducible by hand.
- **"About 1.4 minutes" is the local time;** CI took about 2.2 minutes.
- **"One browser test per scenario" is seven tests for six,** because C2 is its own test.
- **The e2e servers are now defined once,** in `apps/web/e2e/servers.ts`, which both
  `playwright.config.ts` and `pnpm ci:local` use.

## Status note — 2026-10-25

- **Markdown rendering is no longer unbuilt.** ADR-0022 renders a safe subset in chat (bold,
  italic, code, lists, headings, tables) through our own parser
  (`apps/web/src/features/chat/lib/chat-text.ts`), still by interpolation with no `v-html` and no
  links. The list of unbuilt UI above, and the ADR-0016 reference "why chat text is not rendered as
  markdown", predate it.
- **The composer buttons are no longer unbuilt.** The empty transcript offers S-A to S-E as
  one-click suggestions that send each scenario's verbatim step-1 prompt
  (`apps/web/src/features/chat/lib/suggestions.ts`, whose unit test reads the prompts back out of
  `docs/demo-scenarios.md`), and S-F, which needs an outside host, gets the MCP endpoint to copy
  instead. They sit in the transcript rather than the composer, and go once the conversation
  starts. The scenario specs still type the prompts, as this ADR's verbatim-prompt rule has them.
