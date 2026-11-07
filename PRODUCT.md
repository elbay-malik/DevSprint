# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: hiring reviewers.** Senior engineers and tech leads, Berlin market first, deciding
whether the author can design agent systems. They arrive from a CV, a portfolio link or the GitHub
repo. They spend a few minutes on the live demo, the README and the demo video, and some read the
ADRs and the tests. Their job is to judge four things, quickly and with evidence:

- the quality of the tool design
- the human-in-the-loop design
- streaming UI
- MCP interoperability

**In-universe persona: a tech lead running a sprint through chat.** They ask how the sprint is
going, close issues, draft release notes and start deployments. The product is designed so that
using it as this persona is how a reviewer evaluates it.

No other audience is confirmed. Prospective clients and the wider developer community are not
design targets.

## Product Purpose

DevSprint Copilot is an AI copilot that operates a sprint board through an agent loop with tools.
It answers from the board, drafts release notes, runs deployments, and changes nothing without a
person's approval. It exists as a portfolio-grade demonstration of agentic AI, MCP and generative
UI. It is not a commercial product.

Success, from `docs/product-brief.md`:

1. All six demo scenarios (`docs/demo-scenarios.md`) run on the live demo URL.
2. An external MCP host, such as Claude Desktop or Cursor, can operate the same workspace.
3. Running cost stays at 5 EUR a month or less, with a target of zero.

## Positioning

- **Every write the copilot proposes waits until a person approves it.** An approval is a signed,
  single-use card, kept in the transcript as the record of who allowed what.
- **The issue tools are served twice from one implementation:** to the in-app agent, and over a
  public MCP server to any outside AI assistant. Both write to the same live board, and an outside
  assistant's writes are gated by its own host's permission prompt.
- **The quality claims are tested, not asserted.** Tests check the page, the stream and the
  stored board for each scenario. A mutation pass proved the tests can fail, and live-model runs
  surfaced what the scripted model hid.

## Operating Context

- **Live demo:** https://devsprint-web.eleo-666.workers.dev
- **API:** https://devsprint-api.eleo-666.workers.dev
- **Public MCP endpoint:** `https://devsprint-mcp-issues.eleo-666.workers.dev/mcp`

All three run on Cloudflare Workers. The demo model is Groq `openai/gpt-oss-120b` (ADR-0026).

Two panes, side by side:

- **The chat:** the agent streams answers, tool calls, rich result cards and approval cards.
- **The workspace:** a five-column sprint board plus a backlog, showing each approved change.

**There is one board, shared by every visitor.** It resets at midnight UTC, and a header button
resets it at any time.

**The evaluation path:** the live demo, then the README, then the demo video (`docs/demo-video.md`
storyboard; recording pending), then the ADRs and tests on GitHub.

## Capabilities and Constraints

**Capabilities**

- **Ask:** grounded answers from read tools.
- **Act with approval:** gated writes, namely issue status changes, reassignments, new issues,
  saving release notes, and deployments. Several open board changes can be approved in one press,
  and an applied status change, reassignment or new issue can be undone from its card.
- **Watch:** a multi-stage deployment streams progress live and can be cancelled.
- **See:** results render as cards: an issue table, a burndown chart, a release-notes diff, a
  deployment card and an error card.

**Terminology**

- workspace, board, sprint, backlog
- issue keys `DS-<n>`, for the fictional "Nimbus" team's project DS
- approval card
- the scenarios S-A to S-F
- the copilot

**Constraints**

- No authentication and no multi-tenancy. Mobile app, real tracker or CI integrations, and
  persistence beyond the demo workspace are non-goals.
- Free-tier model capacity bounds use: Groq allows about 8K tokens a minute, and there is no
  fallback when it runs out. A per-IP rate limit, a daily token share per client and a daily
  token cap protect it.
- Chat text renders a safe markdown subset. There is no `v-html` and there are no links (ADR-0022).

**Unbuilt or open**

- The Sprint and Deploys tabs.
- A release-notes badge.
- A distinct "interrupted" deployment stage state.
- The sprint selector in the header (the agent scopes by sprint itself).

## Brand Commitments

- **Name:** DevSprint Copilot.
- **Voice:** confident and product-like. Product copy is crisp and benefit-led, and reads like a
  shipped tool. Limits and caveats belong in the docs and ADRs, not in the product UI, except
  where a visitor's messages go, which they need to know before typing. It is never dishonest:
  nothing claims a capability that doesn't exist.
- **The demo's fictional world:** the "Nimbus" team and the sprint-12 seed in
  `docs/domain-model.md`.

## Evidence on Hand

- The live demo and the public MCP endpoint, both above.
- `docs/`: product brief, domain model, tool inventory, six demo scenarios, wireframes, roadmap,
  and 23 ADRs.
- Tests, kept current by the code (`pnpm test`, `pnpm --filter @devsprint/web test:e2e`):
  - unit and eval tests
  - browser tests, one per scenario plus accessibility across UI states and both themes
  - live-model scenario runs on demand
- Lighthouse 100 in all four categories on the live site, mobile and desktop (ADR-0019).

**Absences:** there are no users, customers, testimonials, usage metrics or press, and none may
be invented. The demo video is not yet recorded.

## Product Principles

1. **Grounded, never guessed.** Every fact the copilot states comes from a tool result.
2. **The human holds the pen.** Every change is proposed, approved and recorded one by one. A
   reviewed batch of board changes can be approved in one go, and an applied board change can be
   taken back.
3. **Show, don't claim.** Each capability can be seen working live in one short session, with
   cause in the chat and effect on the board.
4. **One board, any client.** The SPA and outside AI assistants act on the same workspace through
   the same tools.
5. **Earned confidence.** The product speaks with confidence because the docs and tests carry the
   evidence. When they can't, the claim isn't made.

## Accessibility & Inclusion

The bar is WCAG 2.2 AA in both light and dark themes. It is gated in CI by axe across five UI
states (ADR-0017). Keyboard access to every scrolling region and every control is part of that
bar.
