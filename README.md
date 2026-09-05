# DevSprint Copilot

[![CI](https://github.com/EleoXDA/DevSprint/actions/workflows/ci.yml/badge.svg)](https://github.com/EleoXDA/DevSprint/actions/workflows/ci.yml)

A project/DevOps copilot over a mock sprint workspace — Vue 3 SPA (Vite 8) + Hono-on-Cloudflare-Workers backend running an AI SDK v6 agent loop, evolving into a bidirectional MCP story (the backend is an MCP client; one MCP server is publicly exposed to external hosts like Claude Desktop).

## Status

Early development. Implemented so far: repo bootstrap + Phase 0 (design docs) + Phase 1 (SPA shell) + Phase 2 (streaming chat) + Phase 3 (first real tools via plain function calling) of the [16-phase roadmap](docs/roadmap.md). **Local-only but deploy-ready**: wrangler configs and deploy scripts are committed; nothing is deployed yet.

## Architecture at a glance

- **Frontend**: plain Vue 3 SPA (3.6-track) on Vite 8 (Rolldown), TypeScript strict, Pinia, Vue Router, shadcn-vue (Reka UI + Tailwind v4).
- **Backend**: Hono on Cloudflare Workers running the AI SDK v6 agent server-side (holds all model keys) — currently `streamText` + the six read/rich-data tools over the seed workspace; `ToolLoopAgent` multi-step chaining is Phase 4. Groq primary, Gemini Flash fallback (see [Model providers](#model-providers)).
- **MCP (Phase 6+)**: backend becomes an MCP client over Streamable HTTP to 2–3 custom MCP servers on Workers; the issues server gets publicly exposed.
- **Safety**: every write tool is human-approved in-stream (HITL), with server-side re-validation.

See [docs/](docs/README.md) for the product brief, domain model, tool inventory, demo scenarios, wireframes, and ADRs.

## Monorepo layout

| Path                 | Package                    | Purpose                                             |
| -------------------- | -------------------------- | --------------------------------------------------- |
| `apps/web`           | `@devsprint/web`           | Vue 3 SPA (Vite 8, shadcn-vue)                      |
| `apps/api`           | `@devsprint/api`           | Hono Worker — chat endpoint, agent loop             |
| `packages/shared`    | `@devsprint/shared`        | Shared TS types, API route constants, fixtures      |
| `apps/mcp-issues`    | `@devsprint/mcp-issues`    | _(planned, Phase 6)_ issues MCP server              |
| `apps/mcp-deploys`   | `@devsprint/mcp-deploys`   | _(planned, Phase 6)_ deploys MCP server             |
| `apps/mcp-analytics` | `@devsprint/mcp-analytics` | _(planned, Phase 6, optional)_ analytics MCP server |

## Prerequisites

- [fnm](https://github.com/Schniz/fnm) — auto-switches to Node 24.18 via `.node-version`
- corepack (`corepack enable`) — provides pnpm 11.10 pinned via the `packageManager` field

## Getting started

```sh
git clone git@github.com:EleoXDA/DevSprint.git
cd DevSprint
corepack enable
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # model keys, optional (see below)
pnpm dev        # runs all dev servers in parallel (web on :5173, api on :8787)
```

Fill `GROQ_API_KEY` and/or `GOOGLE_GENERATIVE_AI_API_KEY` in `apps/api/.dev.vars` (gitignored). With no keys the api falls back to a scripted mock model, so the app still runs end-to-end — tool calls included — without spending any model quota.

### Model providers

Routing follows [ADR-0005](docs/adr/0005-model-routing-groq-primary-gemini-fallback.md): Groq `llama-3.3-70b-versatile` is the primary model and Gemini `gemini-2.5-flash` the fallback, used when Groq fails with a retryable error, a 429, or a 5xx. `MODEL_PROVIDER=auto|groq|gemini|mock` in `apps/api/.dev.vars` selects the route — `auto` (default) uses whichever keys are present and drops to the mock when there are none; `GROQ_MODEL` / `GEMINI_MODEL` override the model ids. Each chat response reports the resolved route in the `X-DevSprint-Model` header. The daily token-cap kill-switch from the ADR is deferred to Phase 11. Details in [apps/api/README.md](apps/api/README.md).

## Scripts

| Script              | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `pnpm dev`          | all package dev servers in parallel                 |
| `pnpm lint`         | ESLint (single root flat config)                    |
| `pnpm format:check` | Prettier check                                      |
| `pnpm typecheck`    | recursive per-package typecheck                     |
| `pnpm test`         | recursive Vitest                                    |
| `pnpm build`        | recursive builds (web: vite; api: wrangler dry-run) |

Browser tests live in `apps/web`:

```sh
pnpm --filter @devsprint/web test:e2e
```

Playwright starts both servers itself and pins the scripted mock model, so the end-to-end run
needs no API key and never spends provider quota. The full six-scenario suite is Phase 13.

**Package contract**: every workspace package exposes `typecheck` (web: `vue-tsc --noEmit`; others: `tsc --noEmit`) and, where meaningful, `test` (`vitest run`) and `build`. `pnpm -r` skips packages missing a script.

## Roadmap

Phases 0–15 are tracked in [docs/roadmap.md](docs/roadmap.md): design docs → SPA shell → streaming echo → real tools → agent loop → HITL approvals → MCP refactor → generative UI → long-running deploy tool → persistence → observability → hardening → a11y/perf → testing → deployment → whitepaper.

## Conventions

- Per-phase [Conventional Commits](https://www.conventionalcommits.org/); readable history is part of the portfolio.
- Dependency versions are pinned exactly in the `pnpm-workspace.yaml` default catalog (`catalog:` protocol); the AI SDK stays on the v6 line (`ai-v6` dist-tag) — npm `latest` is v7.
- TypeScript strict everywhere; one shared `tsconfig.base.json`; no project references.
- Single root ESLint flat config + Prettier; per-package configs are forbidden.
