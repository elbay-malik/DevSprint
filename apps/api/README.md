# @devsprint/api

Hono-on-Cloudflare-Workers backend. It runs the agent server-side (so the browser never sees a
model key) and exposes the mock workspace over HTTP.

## Endpoints

| Route                  | Method | Purpose                                                                 |
| ---------------------- | ------ | ----------------------------------------------------------------------- |
| `/api/health`          | GET    | Liveness probe — `{ "ok": true }`                                       |
| `/api/workspace`       | GET    | The current workspace snapshot; the SPA hydrates its board from it      |
| `/api/workspace/reset` | POST   | Restores the seed board — the demo's reset control                      |
| `/api/chat`            | POST   | AI SDK v6 UI message stream — tool calls, tool results, streamed answer |

## Tools

`POST /api/chat` registers the six read/rich-data tools from
[docs/tool-inventory.md](../../docs/tool-inventory.md): `list_issues`, `search_issues`,
`get_sprint_status`, `get_deployment_history`, `get_burndown`, and `diff_release_notes`.

Three write tools are registered and gated: `create_issue`, `update_issue_status` and
`create_release_notes`. `run_deployment` waits for its simulation in Phase 8.

### The reset endpoint is deliberately not gated

`POST /api/workspace/reset` restores the seed without an approval card, so "every write is gated"
would be an overclaim — every write **the agent can make** is gated. Reset is a demo control, not
something the copilot can reach: it is absent from the tool set, so no prompt can make the agent
call it, and the worst it can do is put the mock workspace back to a known board.

It is deliberately left open rather than restricted to dev, because
[wireframes.md](../../docs/wireframes.md) §1 puts a Reset demo button in the live demo's header and
a dev-only guard would remove it exactly where it is useful. Protecting it from abuse belongs with
the per-IP rate limits in Phase 11, and Phase 9's daily reset supersedes it.

## Approvals

A gated tool carries `needsApproval: true`, so the agent stops and asks instead of running it. The
request is signed with `TOOL_APPROVAL_SECRET`, which is what stops a client fabricating an approval
— without a secret the SDK happily executes an invented one. Because the signature contains no
nonce, a captured approval would otherwise replay forever, so each approval id is single-use: a
repeat is downgraded to a denial rather than applied again
([ADR-0010](../../docs/adr/0010-tool-approval-mechanism-and-replay-protection.md)). Downgrading
rather than rejecting the request matters — answered approvals stay in the client's transcript, so
refusing outright would strand the conversation the first time a resume failed.

Two limits worth knowing. The single-use ledger is in memory, so on Workers it bounds replay within
an isolate rather than globally; D1 (Phase 9) is where it belongs. And with no secret configured
the Worker signs with a random per-isolate secret and warns, rather than running unsigned — that
keeps keyless dev and CI working, but approvals stop verifying after a restart, so set the secret
before deploying.

Tool descriptions and input schemas come verbatim from `@devsprint/shared/tools`; the query
implementations are pure functions over the workspace snapshot and return the shared
`{ ok, data | error }` envelope, so a domain failure is a value the model can read and recover
from, never a thrown error. Nothing calls `Date.now()` — the fixed demo clock `WORKSPACE_NOW`
keeps the scripted scenarios replayable.

## The agent loop

`/api/chat` runs an AI SDK `ToolLoopAgent`: it calls a tool, feeds the result back, and keeps going
until it can answer. A compound question therefore costs several steps — "summarize Sprint 12 and
draft release notes" reads the sprint, then lists what shipped, then writes the answer from both.

The loop is bounded by a step budget (`MAX_STEPS`, one model call per step), which is the
difference between a demo and a quota incident: a model that keeps asking for tools stops at the
budget instead of looping until the daily limit is gone. Three chained tools plus the written
answer fit inside it.

The request's abort signal is passed into the loop, so the composer's Stop button genuinely ends
the turn server-side rather than just hiding the output — no further steps run, and no further
tokens are spent.

## Where the tools come from

The four issue tools — `list_issues`, `search_issues`, `create_issue`,
`update_issue_status` — are sourced from `apps/mcp-issues` over MCP through a service binding, so
the in-app agent and an external host call one implementation rather than two that drift. The other
five are still defined locally, until the deploys and analytics servers exist.

Their definitions are vendored rather than fetched: they are built from the schemas in
`@devsprint/shared/tools`, so there is no `tools/list` at startup and a server that is briefly down
cannot change what the agent can do.

Two things had to survive the hop, and both are tested. The write tools keep `needsApproval`, so the
Phase 5 gates work unchanged — an MCP-sourced tool is an ordinary tool to the SDK. And MCP returns
its own result wrapper, so an adapter unwraps the shared `{ ok, data | error }` envelope; without it
every `result.ok` check in the SPA would read undefined while the model kept answering plausibly.

If the MCP server cannot be reached the agent falls back to the local copies, and says so: every
response carries `X-DevSprint-Tools: mcp | local`. A silent fallback would let a demo look like it
was proving the MCP path while quietly not using it.

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
