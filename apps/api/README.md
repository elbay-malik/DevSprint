# @devsprint/api

Hono-on-Cloudflare-Workers backend. It runs the agent server-side (so the browser never sees a
model key) and exposes the mock workspace over HTTP.

## Endpoints

| Route                         | Method | Purpose                                                                   |
| ----------------------------- | ------ | ------------------------------------------------------------------------- |
| `/api/health`                 | GET    | Liveness probe — `{ "ok": true }`                                         |
| `/api/workspace`              | GET    | The current workspace snapshot; the SPA hydrates its board from it        |
| `/api/workspace/reset`        | POST   | Restores the seed board — the demo's manual reset control (30 s cooldown) |
| `/api/workspace/undo`         | POST   | Reverses one approved board write, `{ changeId }` — a card's Undo         |
| `/api/deployments/:id/cancel` | POST   | Ends a running deployment, `{ cancelToken }` — the card's Cancel button   |
| `/api/chat`                   | POST   | AI SDK v6 UI message stream — tool calls, tool results, streamed answer   |

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
a dev-only guard would remove it exactly where it is useful. Open is not the same as unthrottled,
though ([ADR-0024](../../docs/adr/0024-harden-the-shared-board.md)). The workspace refuses a reset within
30 seconds of the last one, from anyone, with `429 RESET_COOLDOWN`, so a loop can't keep the board
at its seed and wipe everyone's writes. Undo and cancel share a per-IP limit of 30 a minute
(`WRITE_RATE_LIMIT`), and `GET /api/workspace` has its own of 300 a minute (`READ_RATE_LIMIT`).
`RESET_COOLDOWN_SECONDS` sets the cooldown, and the e2e stack passes 0. The board also resets itself once a day
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
[ADR-0013](../../docs/adr/0013-deployment-cancel-as-an-api-route.md). Its body is
`{ cancelToken }`, the token every frame of that run's stream carries. The board lists every
deployment's id, so an id alone would let anyone stop anyone's run. A wrong or missing token is a
`404`, the same as an unknown id.

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
An approval is spent only by a turn that will act on it, so a press the rate limit, a budget or a
missing model config refused stays good, and the limit message says it was not applied. The SDK
reads an answer from any tool part in any state, so before conversion every answer the ledger would
not spend is removed, leaving it nothing else to act on.

Two limits worth knowing. With no secret configured the Worker signs with a random per-isolate
secret and warns, rather than running unsigned — that keeps keyless dev and CI working, but
approvals stop verifying after a restart, so set the secret before deploying. And the ledger is not
an unconditional single-use guarantee: `reset()` clears it along with the board, and it caps at
1,500 entries with the oldest evicted first, so either can in principle let a captured approval
replay once more. Eviction can be forced, because ids reach the ledger before any signature is
checked, though only from the current turn, on signed write-tool parts, and at most 60 a request.
All accepted trade-offs for a demo board, documented in
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

Per [ADR-0021](../../docs/adr/0021-a-live-model-on-the-demo.md) and
[ADR-0026](../../docs/adr/0026-groq-only-on-the-public-demo.md), selected from the environment at
request time:

| `MODEL_PROVIDER` | Behaviour                                                         |
| ---------------- | ----------------------------------------------------------------- |
| `auto` (default) | `GROQ_API_KEY` set → Groq; otherwise `mock`                       |
| `groq`           | Groq; **503** `MODEL_NOT_CONFIGURED` if `GROQ_API_KEY` is missing |
| `mock`           | Scripted local model — no network, no quota                       |

The 503's message does not name the missing key, so an operator finds that in Workers Logs, as the
`model-not-configured` event.

The default is `openai/gpt-oss-120b`, overridable via `GROQ_MODEL`. Groq retired `llama-3.3-70b-versatile`, and gpt-oss beat Groq's other
tool-calling model on the live scenario evals
([ADR-0021](../../docs/adr/0021-a-live-model-on-the-demo.md)). There is no second model to fall back on
([ADR-0026](../../docs/adr/0026-groq-only-on-the-public-demo.md)). Every response carries
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

Three of them, and deliberately not all the same mechanism
([ADR-0016](../../docs/adr/0016-two-spend-controls-and-an-honest-injection-posture.md)):

| Control           | Question it answers            | Where it lives                  | Tunable                                      |
| ----------------- | ------------------------------ | ------------------------------- | -------------------------------------------- |
| Per-IP rate limit | Is one client hammering us?    | Cloudflare's rate-limit binding | `ratelimits` in `wrangler.jsonc`             |
| Daily token cap   | Has the demo spent its budget? | The workspace Durable Object    | `DAILY_TOKEN_CAP` (default `100000`)         |
| Per-client share  | Has this client had its part?  | The workspace Durable Object    | `CLIENT_DAILY_TOKEN_SHARE` (default `25000`) |

The rate limit is bound at 60 requests/60s on `/api/chat`, keyed on `cf-connecting-ip` — far above
a human session, far below a crawler. An IPv6 client is keyed on its /64, because a single host can
hold a whole /64 and take a new address per request. A request with no such header is **not** limited rather than
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

The share is there because the rate limit can't stop one client spending the day: at 60 turns a
minute and about 2,000 tokens a turn, that takes about a minute. It is 25,000 tokens per client per
UTC day, about 12 turns, and it follows the cap's rules: Reset does not clear it, and a new day
starts it again. The client is the rate-limit key, so an IPv6 client is its /64, and the object only
stores a hash of the key and the day, in a map of at most 2,000 clients that the midnight alarm
deletes. A request with no `cf-connecting-ip` has no share to check, and the cap still applies to it.
Several visitors behind one NAT share one share.

Usage is recorded per step, so a turn someone stopped still counts the steps it took. A model call
is also charged as it starts and as it writes, from an estimate, because the SDK reports nothing for
a step that never finishes and a client could otherwise leave mid-call every turn without being
charged (`src/agent/spend-meter.ts`). The estimate for one call is at most 12,000 tokens, about what
one call can cost on Groq's free tier. A step that finishes settles on the provider's figure, and a
call the provider turns down is refunded.

A turn re-reads both limits between steps and ends once one has been reached, closing with that
limit's message. It has no `X-DevSprint-Limit` header, which only marks a turn refused at the door.
This is check-then-record, so concurrent turns can overshoot the cap or a share by about a step each.

Each request is bounded as well: a 256 KB body (413), 4,000 characters in a user message (400), and
4,096 output tokens per model call. Older history is dropped rather than refused, keeping the latest
user message and everything after it, then what fits in 20 messages and 32,000 characters.

A transcript with a system message, a user message holding anything but text, or a tool part marked
`providerExecuted` is a 400. The SPA sends none of them. The second would have the Worker fetch a
file from a URL the client chose, and the third would put a forged result where the SDK does not
look for one.
Provider metadata is removed from every part of every role before conversion. The transcript is
client-held, Groq writes none, and an approval's signature does not live there.

The scripted mock is exempt, so local dev, CI and e2e spend nothing and are never rationed. Set
`DAILY_TOKEN_CAP=0` to turn the cap off entirely, or `CLIENT_DAILY_TOKEN_SHARE=0` for the share; one
does not depend on the other. A missing value means the default, and a nonsense one means off, never
a limit of zero.

No control returns an HTTP error. Each streams back a single readable assistant turn, which is the
"graceful demo budget reached state" ADR-0005 asked for — the transcript stays usable and the SPA
needs no special case. `X-DevSprint-Limit: rate | budget | client-budget` says which one fired, for
anyone debugging.

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

Filling the board with long titles is a cost problem more than an injection one, since a list result
is resent on every later step. So `list_issues` and `search_issues` go to the model shortened once
their JSON passes 12,000 characters, with `truncated: true` beside the list
(`src/agent/model-output.ts`). This uses the SDK's `toModelOutput`, so the cards still read the
whole output. The seed board is well under the limit, so an ordinary turn never meets it.

## Local dev

```sh
cp .dev.vars.example .dev.vars      # optional — without keys the mock model runs
pnpm --filter @devsprint/api dev    # wrangler dev on http://localhost:8787
```

`.dev.vars` is gitignored; in production the same names are set with
`pnpm --filter @devsprint/api exec wrangler secret put GROQ_API_KEY`. CORS is locked to the origin in the `CORS_ORIGIN` var
(`http://localhost:5173` in dev). A POST with any other `Origin` gets a 403 with `FORBIDDEN_ORIGIN`,
so a dev SPA on a fallback port such as 5174 can't write until the var names it. A request with no
`Origin`, like the curl below, still passes: the board is public by design (ADR-0014), and this
only stops other sites using a visitor's browser
([ADR-0025](../../docs/adr/0025-browser-bounds-origin-refusal-and-security-headers.md)). Every
response carries Hono's `secureHeaders` defaults, and stream responses carry
`Content-Encoding: Identity` to defeat
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

Before it ships anything, the script can refuse:

- **From a laptop, unless the checkout is on `main`, has no changes to tracked files, and sits at
  `origin/main` after a fresh fetch.** Untracked files are fine. A feature branch or worktree is
  refused even at the same commit. `--skip-git-gate` deploys anyway, for a hotfix or when offline.
  CI skips this check, because it checks out a detached HEAD of the commit it is deploying.
- **When the api exists and lacks the key `MODEL_PROVIDER` needs.** `auto` needs `GROQ_API_KEY`, and
  would otherwise serve the scripted mock. A new api only gets a
  warning, because a Worker that does not exist cannot hold secrets yet.
- **When `MODEL_PROVIDER` is not one the api knows,** whether the api exists or not, because no
  secret can fix that.

`--plan` is never blocked. It reports a missing key as a line in the plan, saying what a real deploy
would do: stop if the api exists, warn and carry on if it is new.

The smoke checks' board write and reset run only when the api is new, because that is the only time
nobody can be using the board. If a step or a smoke check fails after something shipped, the script
prints the `wrangler rollback` commands for those Workers and rolls nothing back itself: the Workers
call each other, so which ones go back together is a decision to make with the failure in front of
you.

Push to `main` runs the same script in CI once the checks and e2e jobs pass. Locally it uses your
`wrangler login`; CI uses the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, given only
to the step that runs the script. `pnpm smoke` re-runs the read-only checks at any time.

The deployed values live in `wrangler.jsonc` `vars`. `MODEL_PROVIDER` is `auto`, so the live demo
runs Groq `openai/gpt-oss-120b`
([ADR-0026](../../docs/adr/0026-groq-only-on-the-public-demo.md)). The provider key is a Worker
secret:

```sh
pnpm --filter @devsprint/api exec wrangler secret put GROQ_API_KEY
```

Setting `MODEL_PROVIDER` back to `mock` in `wrangler.jsonc` puts the demo on the scripted model,
which spends nothing. That is a reviewable change, not a dashboard toggle.
