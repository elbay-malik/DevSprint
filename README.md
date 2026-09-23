# DevSprint Copilot

[![CI](https://github.com/EleoXDA/DevSprint/actions/workflows/ci.yml/badge.svg)](https://github.com/EleoXDA/DevSprint/actions/workflows/ci.yml)

A project/DevOps copilot over a mock sprint workspace — Vue 3 SPA (Vite 8) + Hono-on-Cloudflare-Workers backend running an AI SDK v6 agent loop, evolving into a bidirectional MCP story (the backend is an MCP client; one MCP server is publicly exposed to external hosts like Claude Desktop).

## Status

Early development. Implemented so far: Phases 0–11 of the [16-phase roadmap](docs/roadmap.md) — design docs, SPA shell, streaming chat, real tools, a multi-step agent loop, approval gates on every write, the MCP refactor with a public issues server, the in-stream result cards, the long-running deploy tool with mid-run cancel, a daily reset alarm with a persisted approval ledger, OTLP tracing with trajectory evals for all six demo scenarios, and two spend controls guarding the live demo. **Local-only but deploy-ready**: wrangler configs and deploy scripts are committed; nothing is deployed yet.

## Architecture at a glance

- **Frontend**: plain Vue 3 SPA (3.6-track) on Vite 8 (Rolldown), TypeScript strict, Pinia, Vue Router, shadcn-vue (Reka UI + Tailwind v4). Tool results render as cards in the transcript — an issue table, a burndown chart drawn as inline SVG ([ADR-0012](docs/adr/0012-burndown-chart-as-inline-svg.md)), a release-notes diff, and a typed error card.
- **Backend**: Hono on Cloudflare Workers running the AI SDK v6 `ToolLoopAgent` server-side (holds all model keys) — it chains the six read/rich-data tools over the seed workspace until it can answer, bounded by a step budget, and the composer's Stop button aborts the loop mid-turn. Groq primary, Gemini Flash fallback (see [Model providers](#model-providers)).
- **MCP**: `apps/mcp-issues` serves the four issue tools over Streamable HTTP, and the in-app agent sources those same four from it through an MCP client — one implementation, two clients. It owns no state: both Workers reach one workspace Durable Object, so a write made in an external host shows up on the SPA's board ([ADR-0011](docs/adr/0011-workspace-state-in-a-durable-object.md)).
- **Long-running work**: `run_deployment` is an async generator, so every stage of a simulated deploy reaches the browser as a preliminary tool result and the progress card redraws from the same shape it will settle on. Cancel is an api route rather than the request's abort signal, because a browser that stops reading a stream does not reliably abort the Worker's request — the deploy would otherwise run to completion while the card claimed it had stopped ([ADR-0013](docs/adr/0013-deployment-cancel-as-an-api-route.md)).
- **Safety**: every write the agent can make is human-approved in-stream before it runs. Approval requests are signed so a forged one cannot execute, and each is single-use so a captured one is downgraded to a denial rather than applied twice. The single-use ledger lives in the same Durable Object as the workspace, so replay protection holds across isolates and restarts, not just within one — with two named exceptions, not a blanket guarantee: it clears on reset, and it caps at 1,500 entries with the oldest evicted first ([ADR-0010](docs/adr/0010-tool-approval-mechanism-and-replay-protection.md), [ADR-0014](docs/adr/0014-daily-reset-alarm-and-a-persisted-approval-ledger.md)).
- **Observability**: a turn's spans export to Langfuse as OTLP/HTTP JSON, written by hand rather than with the OpenTelemetry SDK — the AI SDK hands over a tracer, so all that is actually needed is `AsyncLocalStorage` for span parentage and a `fetch` ([ADR-0015](docs/adr/0015-otlp-tracing-without-the-opentelemetry-sdk.md)). Tracing is off unless configured, and a failed export never fails a turn. The six demo scenarios' own eval assertions run as trajectory evals in CI.
- **Spend controls**: two of them, deliberately different mechanisms ([ADR-0016](docs/adr/0016-two-spend-controls-and-an-honest-injection-posture.md)). A per-IP rate limit on the chat route uses Cloudflare's binding, whose documented looseness is fine for "is one client hammering us". The daily token cap lives in the workspace Durable Object instead, because that binding disclaims being an accounting system and counts per location — and a cap that undercounts is not a cap. It survives Reset on purpose, and both controls degrade into a readable assistant turn rather than an error.
- **Reset**: the board resets itself every day at UTC midnight, via the same Durable Object's own alarm — no external cron trigger. Multi-tenancy is a deliberate non-goal, so this is one shared demo board, not a private copy per visitor ([ADR-0014](docs/adr/0014-daily-reset-alarm-and-a-persisted-approval-ledger.md)).

See [docs/](docs/README.md) for the product brief, domain model, tool inventory, demo scenarios, wireframes, and ADRs.

## Monorepo layout

| Path                 | Package                    | Purpose                                             |
| -------------------- | -------------------------- | --------------------------------------------------- |
| `apps/web`           | `@devsprint/web`           | Vue 3 SPA (Vite 8, shadcn-vue)                      |
| `apps/api`           | `@devsprint/api`           | Hono Worker — chat endpoint, agent loop             |
| `packages/shared`    | `@devsprint/shared`        | Shared TS types, API route constants, fixtures      |
| `apps/mcp-issues`    | `@devsprint/mcp-issues`    | Public issues MCP server (Streamable HTTP)          |
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
| `pnpm eval`         | trajectory evals for the 6 demo scenarios           |
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
