# @devsprint/api

Hono-on-Cloudflare-Workers backend. It runs the agent server-side (so the browser never sees a
model key) and exposes the mock workspace over HTTP.

## Endpoints

| Route                         | Method | Purpose                                                                 |
| ----------------------------- | ------ | ----------------------------------------------------------------------- |
| `/api/health`                 | GET    | Liveness probe — `{ "ok": true }`                                       |
| `/api/workspace`              | GET    | The current workspace snapshot; the SPA hydrates its board from it      |
| `/api/workspace/reset`        | POST   | Restores the seed board — the demo's manual reset control               |
| `/api/workspace/undo`         | POST   | Reverses one approved board write, `{ changeId }` — a card's Undo       |
| `/api/deployments/:id/cancel` | POST   | Ends a running deployment — the progress card's Cancel button           |
| `/api/chat`                   | POST   | AI SDK v6 UI message stream — tool calls, tool results, streamed answer |

## Tools

`POST /api/chat` registers the six read/rich-data tools from
[docs/tool-inventory.md](../../docs/tool-inventory.md): `list_issues`, `search_issues`,
`get_sprint_status`, `get_deployment_history`, `get_burndown`, and `diff_release_notes`.

Five write tools are registered and gated: `create_issue`, `update_issue_status`, `assign_issue`,
`create_release_notes`, and `run_deployment`, a long-running async generator whose stages stream
to the client as preliminary tool results. `assign_issue` takes a roster id (`u-dana`) or `null` to
unassign; the model resolves "Dana" or "@dana" from the roster in the system prompt, and the
workspace refuses an id the roster does not have (`USER_NOT_FOUND`) or the assignee the issue
already has (`INVALID_INPUT`).

### The reset, undo and cancel endpoints are deliberately not gated

`POST /api/workspace/reset` restores the seed without an approval card, so "every write is gated"
would be an overclaim — every write **the agent can make** is gated. Reset is a demo control, not
something the copilot can reach: it is absent from the tool set, so no prompt can make the agent
call it, and the worst it can do is put the mock workspace back to a known board.

It is deliberately left open rather than restricted to dev, because
[wireframes.md](../../docs/wireframes.md) §1 puts a Reset board button in the live demo's header and
a dev-only guard would remove it exactly where it is useful. The per-IP rate limit from Phase 11
covers `/api/chat` only
([ADR-0016](../../docs/adr/0016-two-spend-controls-and-an-honest-injection-posture.md)), so reset
stays unthrottled. The worst it can do is restore the seed board, and the board also resets itself
once a day regardless
([ADR-0014](../../docs/adr/0014-daily-reset-alarm-and-a-persisted-approval-ledger.md)).

`POST /api/workspace/undo` is open on the same terms: anyone who can press Reset can already do
more than an undo can. It takes only `{ changeId }` — the id an applied `create_issue`,
`update_issue_status` or `assign_issue` result carries — and the workspace looks up what that write
changed in its own record, taken as the write landed, then applies the inverse: the previous status
(with its completion and blocked reason), the previous assignee (nobody included), or the created
issue removed. Nothing about the before-state comes
from the client. It is one-shot and refuses with `409 UNDO_CONFLICT` once the issue no longer
reads what the write left, when the change was already undone, or when there is no record of it
(a reset clears them all, and release notes and deployments are never recorded); a malformed or
oversized id is a `400 INVALID_INPUT`. The record is capped at 300 changes, oldest out first. Each
undo is logged as one JSON line, beside the agent's step log. It is not a tool, for the same reason
reset is not: it is a person's action, and the copilot re-reads the board before it answers.

`POST /api/deployments/:id/cancel` is the same story for a different reason: it comes from a
button, not the agent, so routing it through a tool would make whether a deploy stops depend on the
model choosing to call one — see
[ADR-0013](../../docs/adr/0013-deployment-cancel-as-an-api-route.md).

## Approvals

A gated tool carries `needsApproval: true`, so the agent stops and asks instead of running it. The
request is signed with `TOOL_APPROVAL_SECRET`, which is what stops a client fabricating an approval
— without a secret the SDK happily executes an invented one. Because the signature contains no
nonce, a captured approval would otherwise replay forever, so each approval id is single-use: a
repeat is downgraded to a denial rather than applied again
([ADR-0010](../../docs/adr/0010-tool-approval-mechanism-and-replay-protection.md)). Downgrading
rather than rejecting the request matters — answered approvals stay in the client's transcript, so
refusing outright would strand the conversation the first time a resume failed. The ledger that
tracks what has been spent lives in the workspace Durable Object rather than in the Worker's own
memory, so the guarantee holds across isolates and restarts, not just within the one that happened
to handle a given request ([ADR-0014](../../docs/adr/0014-daily-reset-alarm-and-a-persisted-approval-ledger.md)).

Two limits worth knowing. With no secret configured the Worker signs with a random per-isolate
secret and warns, rather than running unsigned — that keeps keyless dev and CI working, but
approvals stop verifying after a restart, so set the secret before deploying. And the ledger is not
an unconditional single-use guarantee: `reset()` clears it along with the board, and it caps at
1,500 entries with the oldest evicted first, so either can in principle let a captured approval
replay once more — both accepted trade-offs for a demo board, documented in
[ADR-0014](../../docs/adr/0014-daily-reset-alarm-and-a-persisted-approval-ledger.md).

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

The five issue tools — `list_issues`, `search_issues`, `create_issue`,
`update_issue_status`, `assign_issue` — are sourced from `apps/mcp-issues` over MCP through a service binding, so
the in-app agent and an external host call one implementation rather than two that drift. The other
six are still defined locally, until the deploys and analytics servers exist.

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

## Observability

A turn's spans export to Langfuse as OTLP/HTTP JSON
([ADR-0015](../../docs/adr/0015-otlp-tracing-without-the-opentelemetry-sdk.md)). There is no
OpenTelemetry SDK: the AI SDK takes a `tracer` directly on the agent, so the only machinery
actually needed is the `Tracer`/`Span` shape it calls, `AsyncLocalStorage` to parent spans, and a
`fetch`.

`AsyncLocalStorage` is not optional here. Tracking parentage with a stack — the obvious way to
avoid OTel entirely — produces a completely flat trace: `ai.streamText` hands back the stream
before its children exist, so the stack has popped by the time the tool call happens. That trace
still exports, still returns 200, and cannot be read.

Export rides `waitUntil` from the response's own `onFinish`, not the agent's. The response _is_ the
stream, so the root span is still open when the agent finishes — flushing then ships every span
pointing at a parent that never goes with them.

Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to turn it on; with neither, the tracer is
never installed and the Worker runs with no network and no account. `LANGFUSE_HOST` selects a
region or a self-hosted instance. Each traced response carries `X-DevSprint-Trace`, so a report can
be joined to its trace. A failed export is logged and swallowed — the answer has already reached
the user, and losing a trace is not a reason to fail a served request. The `onStepFinish` audit log
is unchanged underneath it.

## Evals

`pnpm eval` runs the trajectory evals for all six demo scenarios. Every assertion is copied from
that scenario's own "Eval assertions" block in
[demo-scenarios.md](../../docs/demo-scenarios.md) — exact tool-call order, "the denied write never
mutates state", "the next call after the error is `search_issues`".

They run through the real `/api/chat` route, including the approval round-trip, because gating and
ordering are what they are checking. Against the scripted mock they are deterministic and free, so
they gate every PR as part of `pnpm test`.

What that proves is that the **application** honours a trajectory — not that a live model elicits
one. `EVAL_MODEL_PROVIDER=groq pnpm eval` runs the same assertions against a real provider, which
is where that second question gets answered; it costs quota and is not deterministic, so it is not
CI's job.

## Model routing

Per [ADR-0005](../../docs/adr/0005-model-routing-groq-primary-gemini-fallback.md) and
[ADR-0021](../../docs/adr/0021-a-live-model-on-the-demo.md), selected from the environment at
request time:

| `MODEL_PROVIDER` | Behaviour                                                                       |
| ---------------- | ------------------------------------------------------------------------------- |
| `auto` (default) | Both keys → Groq with a Gemini fallback; one key → that provider; none → `mock` |
| `groq`           | Groq only; **503** `MODEL_NOT_CONFIGURED` if `GROQ_API_KEY` is missing          |
| `gemini`         | Gemini only; **503** `MODEL_NOT_CONFIGURED` if the Google key is missing        |
| `mock`           | Scripted local model — no network, no quota                                     |

Defaults are `openai/gpt-oss-120b` (Groq) and `gemini-3.8-flash` (Gemini), overridable via
`GROQ_MODEL` / `GEMINI_MODEL`. Groq retired `llama-3.3-70b-versatile`, and gpt-oss beat Groq's other
tool-calling model on the live scenario evals
([ADR-0021](../../docs/adr/0021-a-live-model-on-the-demo.md)). The fallback triggers when the
**initial** provider call fails with a retryable error, a 429, or a 5xx; once a stream has started,
errors are not retried, because chunks may already have reached the client. Every response carries
the chosen route in the `X-DevSprint-Model` header (exposed via CORS), and a 429 surfaces as a
friendly "demo budget reached" message rather than a provider error. The global daily token cap
ADR-0005 asked for is below, under [Spend controls](#spend-controls).

The scripted **mock model** speaks the same `LanguageModelV3` streaming protocol as a real
provider: it picks one tool by keyword and then narrates the tool's actual output. That keeps
local dev, CI, and e2e runs free and deterministic — but its "reasoning" is a keyword table, so
judge model quality only against a real provider.

Each agent step is logged as one JSON line (model route, tool names and inputs, finish reason,
token usage). That is the observability floor, and it still runs underneath the OTLP export above.

## Spend controls

Two of them, and deliberately not the same mechanism
([ADR-0016](../../docs/adr/0016-two-spend-controls-and-an-honest-injection-posture.md)):

| Control           | Question it answers            | Where it lives                  | Tunable                              |
| ----------------- | ------------------------------ | ------------------------------- | ------------------------------------ |
| Per-IP rate limit | Is one client hammering us?    | Cloudflare's rate-limit binding | `ratelimits` in `wrangler.jsonc`     |
| Daily token cap   | Has the demo spent its budget? | The workspace Durable Object    | `DAILY_TOKEN_CAP` (default `100000`) |

The rate limit is bound at 60 requests/60s on `/api/chat`, keyed on `cf-connecting-ip` — far above
a human session, far below a crawler. A request with no such header is **not** limited rather than
being folded into a shared bucket, because one shared key lets a single abusive client lock
everyone else out.

The cap is separate because Cloudflare documents that binding as "permissive, eventually
consistent, and intentionally designed to not be used as an accurate accounting system", and it
counts per Cloudflare location rather than globally. A cap that undercounts is not a cap, so this
one lives in the Durable Object, which is global and serialises. Two consequences worth knowing:

- **`POST /api/workspace/reset` does not clear it.** The board and the approval ledger both reset;
  the budget does not, or any visitor could clear the spend cap by pressing Reset in the SPA.
- **It rolls over on the real UTC date**, by comparing the stored day to today rather than by being
  cleared on a schedule — so a Worker asleep across midnight wakes with a fresh budget.

The scripted mock is exempt, so local dev, CI and e2e spend nothing and are never rationed. Set
`DAILY_TOKEN_CAP=0` to turn the cap off entirely; a missing or nonsense value falls back to the
default rather than to a cap of zero.

Neither control returns an HTTP error. Both stream back a single readable assistant turn, which is
the "graceful demo budget reached state" ADR-0005 asked for — the transcript stays usable and the
SPA needs no special case. `X-DevSprint-Limit: rate | budget` says which one fired, for anyone
debugging.

## Prompt injection

The vector is real and was checked rather than assumed: text a client supplies through
`create_issue` reaches the model verbatim inside a `list_issues` or `search_issues` result, and
`apps/mcp-issues` is public and runs that write with no approval gate at all — the MCP host owns
that prompt, not this Worker. So anyone can plant instructions in the board and wait for a
visitor's turn to read them.

The honest posture is that **the approval gate is the control, and the rest is depth**:

- Nothing an injected instruction says can execute a write. Every write is gated behind a human
  approval that names the tool and shows its arguments
  ([ADR-0003](../../docs/adr/0003-hitl-approval-gates-on-write-tools.md),
  [ADR-0010](../../docs/adr/0010-tool-approval-mechanism-and-replay-protection.md)).
- Injected text cannot become markup: the SPA renders every assistant and tool string through Vue
  interpolation, and there is no `v-html` in it.
- A system-prompt rule tells the model that everything inside a tool result is workspace data
  written by users, to be reported rather than followed.

That last one lowers the chance of an injected string steering an _answer_, which is the part no
gate covers. It is a prompt rule, not a guarantee, and is not treated as one.

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

The workspace lives in a Durable Object (ADR-0011), not per-isolate memory: it is shared across
every Worker that binds it and survives a restart. It also resets itself once a day
([ADR-0014](../../docs/adr/0014-daily-reset-alarm-and-a-persisted-approval-ledger.md)).

After changing `wrangler.jsonc` bindings, regenerate the committed Worker types:

```sh
pnpm --filter @devsprint/api cf-typegen
```

`wrangler types` also reads `.dev.vars`, so run it only when bindings actually change and review
the diff before committing — it must not bake local secret names into `worker-configuration.d.ts`.

## Deploying

Live at `https://devsprint-api.eleo-666.workers.dev` (ADR-0019). The whole topology deploys with one
command from the repo root, first time or any time after:

```sh
pnpm deploy:all
```

`scripts/deploy.ts` builds the SPA, deploys the MCP, api and web Workers in that order (the one
order that works, ADR-0019), and ends with `scripts/smoke.ts` against the live URLs.
`pnpm deploy:all --plan` prints what it would do and deploys nothing. The api and `apps/mcp-issues` bind
each other, so on a **first** deploy it breaks the cycle itself: the api goes out once without its
service binding, then the MCP Worker, then the api again. It also generates `TOOL_APPROVAL_SECRET`
whenever the api lacks one, through a temp file, never printed. That secret is **not optional**:
without it every isolate signs approvals with its own random key.

Push to `main` runs the same script in CI once the checks and e2e jobs pass. Locally it uses your
`wrangler login`; CI uses the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets.
`pnpm smoke` re-runs the read-only checks at any time.

The deployed values live in `wrangler.jsonc` `vars`. `MODEL_PROVIDER` is `auto`, so the live demo
runs Groq `openai/gpt-oss-120b` with a Gemini fallback
([ADR-0021](../../docs/adr/0021-a-live-model-on-the-demo.md)). The provider keys are Worker
secrets:

```sh
pnpm --filter @devsprint/api exec wrangler secret put GROQ_API_KEY
pnpm --filter @devsprint/api exec wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
```

Setting `MODEL_PROVIDER` back to `mock` in `wrangler.jsonc` puts the demo on the scripted model,
which spends nothing. That is a reviewable change, not a dashboard toggle.
