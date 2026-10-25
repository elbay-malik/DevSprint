# DevSprint Copilot — product brief

## What

DevSprint Copilot is a project/DevOps copilot that operates a **mock software-delivery workspace**
(projects, sprints, issues, users, deployments) through an agent loop with tools. It is a
portfolio-grade demonstration of agentic AI + MCP + generative UI — not a real product. Every
capability is designed to be shown live: the agent reads and writes the workspace in a chat pane
while its effects appear simultaneously in a workspace pane.

## Who it's for

- **In-universe persona:** a tech lead running a sprint via chat — asking how the sprint is going,
  closing issues, drafting release notes, kicking off deploys.
- **Real audience:** senior/tech-lead reviewers (Berlin market) evaluating agent-architecture
  skills: tool design, human-in-the-loop approval, streaming UI, and MCP interop.

## The mock workspace

One project — **DS**, the fictional Nimbus web product team — with 2 sprints (one completed, one
active), 13 issues on a five-column board (todo / in_progress / in_review / blocked / done),
4 users, 5 deployments, and 1 published release note. The seed is deterministic with a fixed demo
clock. The live board resets to it every UTC midnight (Phase 9, ADR-0014), and the header's Reset
board button resets it on demand. Exact values live in [domain-model.md](./domain-model.md).

## Core capabilities

Each capability maps to a tool risk class (see [tool-inventory.md](./tool-inventory.md)):

- **Ask** — read/query tools answer sprint questions grounded in workspace data.
- **Act with approval** — every write is human-approved via in-stream approval cards.
- **Watch** — a simulated multi-stage deployment streams progress into the chat.
- **See** — rich tool results render as chart/table/diff cards in the chat stream, with tool
  effects simultaneously visible in the workspace pane.

## Architecture one-liner

Vue 3 (3.6-track) SPA (Vite 8, shadcn-vue) in `apps/web` → Hono on Cloudflare Workers in
`apps/api` running an AI SDK v6 ToolLoopAgent (Groq primary / Gemini Flash fallback), sharing
types and fixtures via `packages/shared` → an MCP client to one custom MCP server on Workers,
`apps/mcp-issues` (Phase 6). It serves the four issue tools to the in-app agent and publicly to
Claude Desktop/Cursor, rate-limited per ADR-0020. The SPA ships as a Workers
Static Assets (assets-only Worker) deploy, live since Phase 14 (ADR-0019).

## Non-goals

- Real issue-tracker or CI integrations.
- Auth / multi-tenancy.
- Mobile app.
- Persistence beyond the demo workspace.
- Model training or fine-tuning.

## Success criteria

1. All 6 scenarios in [demo-scenarios.md](./demo-scenarios.md) runnable on the live demo URL.
2. An external MCP host (Claude Desktop/Cursor) can operate the same workspace.
3. Running cost ≤ 5 EUR/month (target 0).

See [roadmap.md](./roadmap.md) for the phase plan and [adr/](./adr/README.md) for decision
records.
