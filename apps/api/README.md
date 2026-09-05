# @devsprint/api

Hono-on-Cloudflare-Workers backend. It runs the agent server-side (so the browser never sees a
model key) and exposes the mock workspace over HTTP.

## Endpoints

| Route            | Method | Purpose                                                                 |
| ---------------- | ------ | ----------------------------------------------------------------------- |
| `/api/health`    | GET    | Liveness probe — `{ "ok": true }`                                       |
| `/api/workspace` | GET    | The current workspace snapshot; the SPA hydrates its board from it      |
| `/api/chat`      | POST   | AI SDK v6 UI message stream — tool calls, tool results, streamed answer |

## Tools

`POST /api/chat` registers the six read/rich-data tools from
[docs/tool-inventory.md](../../docs/tool-inventory.md): `list_issues`, `search_issues`,
`get_sprint_status`, `get_deployment_history`, `get_burndown`, and `diff_release_notes`.

The four write tools (`create_issue`, `update_issue_status`, `create_release_notes`,
`run_deployment`) are deliberately **not** registered yet. Every write is gated behind an
in-stream approval card with server-side re-validation, which lands in Phase 5
([ADR-0003](../../docs/adr/0003-hitl-approval-gates-on-write-tools.md)) — registering them earlier
would mean running an ungated write.

Tool descriptions and input schemas come verbatim from `@devsprint/shared/tools`; the query
implementations are pure functions over the workspace snapshot and return the shared
`{ ok, data | error }` envelope, so a domain failure is a value the model can read and recover
from, never a thrown error. Nothing calls `Date.now()` — the fixed demo clock `WORKSPACE_NOW`
keeps the scripted scenarios replayable.

Multi-step tool chaining (`ToolLoopAgent`) is Phase 4; this phase allows one tool round-trip plus
the answer.

## Model routing

Per [ADR-0005](../../docs/adr/0005-model-routing-groq-primary-gemini-fallback.md), selected from
the environment at request time:

| `MODEL_PROVIDER` | Behaviour                                                                       |
| ---------------- | ------------------------------------------------------------------------------- |
| `auto` (default) | Both keys → Groq with a Gemini fallback; one key → that provider; none → `mock` |
| `groq`           | Groq only; **503** `MODEL_NOT_CONFIGURED` if `GROQ_API_KEY` is missing          |
| `gemini`         | Gemini only; **503** `MODEL_NOT_CONFIGURED` if the Google key is missing        |
| `mock`           | Scripted local model — no network, no quota                                     |

Defaults are `llama-3.3-70b-versatile` (Groq) and `gemini-2.5-flash` (Gemini), overridable via
`GROQ_MODEL` / `GEMINI_MODEL`. The fallback triggers when the **initial** provider call fails with
a retryable error, a 429, or a 5xx; once a stream has started, errors are not retried, because
chunks may already have reached the client. Every response carries the chosen route in the
`X-DevSprint-Model` header (exposed via CORS), and a 429 surfaces as a friendly "demo budget
reached" message rather than a provider error. The global daily token cap named in ADR-0005 is
part of the Phase 11 hardening pass.

The scripted **mock model** speaks the same `LanguageModelV3` streaming protocol as a real
provider: it picks one tool by keyword and then narrates the tool's actual output. That keeps
local dev, CI, and e2e runs free and deterministic — but its "reasoning" is a keyword table, so
judge model quality only against a real provider.

Each agent step is logged as one JSON line (model route, tool names and inputs, finish reason,
token usage). That is the observability floor; Phase 10 replaces it with OTLP export.

## Local dev

```sh
cp .dev.vars.example .dev.vars      # optional — without keys the mock model runs
pnpm --filter @devsprint/api dev    # wrangler dev on http://localhost:8787
```

`.dev.vars` is gitignored; in production the same names are set with
`pnpm --filter @devsprint/api exec wrangler secret put GROQ_API_KEY` (and likewise for
`GOOGLE_GENERATIVE_AI_API_KEY`). CORS is locked to the origin in the `CORS_ORIGIN` var
(`http://localhost:5173` in dev), and stream responses carry `Content-Encoding: Identity` to defeat
wrangler dev / miniflare buffering ([workers-sdk#8004](https://github.com/cloudflare/workers-sdk/issues/8004)).

Smoke test both routes:

```sh
curl -s http://localhost:8787/api/workspace | head -c 120
curl -sN -H 'content-type: application/json' \
  -d '{"messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"How many open issues are in the current sprint?"}]}]}' \
  http://localhost:8787/api/chat
```

The workspace lives in memory, one copy per Worker isolate: it is not shared between isolates and
does not survive a restart. Phase 3 only reads, so that is invisible; D1 persistence and the daily
reset arrive in Phase 9.

After changing `wrangler.jsonc` bindings, regenerate the committed Worker types:

```sh
pnpm --filter @devsprint/api cf-typegen
```

`wrangler types` also reads `.dev.vars`, so run it only when bindings actually change and review
the diff before committing — it must not bake local secret names into `worker-configuration.d.ts`.

## One-time deploy runbook (not executed yet)

1. `pnpm dlx wrangler login`
2. `pnpm --filter @devsprint/api exec wrangler secret put GROQ_API_KEY` (and/or
   `GOOGLE_GENERATIVE_AI_API_KEY`)
3. `pnpm --filter @devsprint/api deploy` — note the printed Worker URL
4. Set `VITE_API_URL` in `apps/web/.env.production` to that URL
5. `pnpm --filter @devsprint/web deploy` — note the printed web URL
6. Update `CORS_ORIGIN` in `apps/api/wrangler.jsonc` (or via a dashboard env override) to the
   web URL and redeploy the api

CI never deploys; `pnpm build` runs `wrangler deploy --dry-run` which needs no Cloudflare auth.
