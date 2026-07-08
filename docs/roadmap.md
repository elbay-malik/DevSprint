# Roadmap — Phases 0–15

Current status: repo bootstrap + Phases 0–2 are implemented in this pass.
The repo is local-only but deploy-ready: wrangler configs and deploy scripts are committed, but no
Cloudflare deploy has been executed (deploy jobs are deferred to Phase 14). Phases 3–15 are planned
and carried here so the repo shows the full pathway from design docs to a live, MCP-enabled demo.

## Phase table

| Phase | Goal                                        | Key acceptance criteria                                                                                                                                                                                                     | Est.         | Status                               |
| ----- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------ |
| 0     | Design docs in `/docs`                      | Tool inventory, demo scenarios, wireframes, domain model, ADRs committed                                                                                                                                                    | 4–8h         | done (this pass)                     |
| 1     | Polished empty SPA shell (`apps/web`)       | Strict TS build passes; two-pane shell renders with placeholder board data and disabled composer; CI lints. Note: shadcn-vue Chart/Unovis deliberately deferred to Phase 7 (generative UI)                                  | 1w           | done (this pass)                     |
| 2     | Worker + streaming chat echo (`apps/api`)   | Token-by-token echo streams Worker → SPA; CORS handled. Note: the brief's "in production" acceptance is deliberately relaxed to "local wrangler dev" per the locked local-only decision — no Cloudflare deploy in this pass | 1w           | done (this pass)                     |
| 3     | First real tools via plain function calling | "How many open issues in the current sprint?" triggers a grounded tool call against the seed workspace                                                                                                                      | 1w           | planned                              |
| 4     | ToolLoopAgent multi-step                    | Agent chains 2–3 tools in one turn; stop button aborts the stream                                                                                                                                                           | 1w           | planned                              |
| 5     | HITL approval gates on all writes           | 5 status changes execute only after explicit per-issue approval; denial is reflected in the final answer                                                                                                                    | 1.5–2w       | planned (risky — approval API churn) |
| 6     | MCP refactor + public issues server         | App behaves identically behind MCP; Claude Desktop can list and call the issues tools remotely                                                                                                                              | 2w           | planned (risky)                      |
| 7     | Generative UI cards                         | Burndown chart, release-notes diff, and deployment progress render in-stream (shadcn-vue Chart/Unovis lands here)                                                                                                           | 1.5–2w       | planned                              |
| 8     | Long-running deployment                     | Simulated multi-stage deploy streams progress and supports mid-run cancel                                                                                                                                                   | 1w           | planned                              |
| 9     | D1 persistence + daily reset                | Workspace persists in D1; daily reset cron; session isolation between visitors                                                                                                                                              | 1w           | planned                              |
| 10    | Observability + evals                       | Cloudflare-native OTLP export to Langfuse; trajectory evals pass for all 6 demo scenarios                                                                                                                                   | 1–1.5w       | planned (risky on workerd)           |
| 11    | Security hardening                          | Prompt-injection mitigations, per-IP rate limits, global token cap kill-switch                                                                                                                                              | 1w           | planned                              |
| 12    | A11y + performance                          | Lighthouse ≥ 95; optional Vapor experiment on Vue 3 (3.6-track), gated on stability                                                                                                                                         | 1w           | planned                              |
| 13    | Test suite green in CI                      | Unit tests + Playwright E2E (driven by the 6 demo scenarios) green in CI                                                                                                                                                    | 1–1.5w       | planned                              |
| 14    | CI/CD deploy topology                       | Backend Worker + one Worker per MCP server + Workers Static Assets SPA; push-to-main deploys; PR previews                                                                                                                   | 1w           | planned                              |
| 15    | Portfolio polish                            | README whitepaper + ADRs finalized + 2–4 min demo video                                                                                                                                                                     | 3–5 evenings | planned                              |

Estimates assume evening/weekend pace. "Risky" rows carry explicit fallbacks — see staged
thresholds below and the ADRs in [adr/](./adr/README.md).

## Staged thresholds

Go/no-go rules condensed from the planning brief's recommendations:

- Vapor mode only when stable: the Phase 12 experiment runs only if Vapor has stabilized on the
  Vue 3 (3.6-track) line and Reka UI confirms compatibility; otherwise skip it entirely
  (see [ADR-0008](./adr/0008-vapor-mode-deferred.md)).
- Skip the public MCP server if Phase 6 slips past 2 weeks — keep the internal MCP refactor,
  drop the externally exposed issues server.
- Model fallback thresholds: route from Groq to Gemini Flash when approaching the free-tier limits
  (1K requests/day or 100K tokens/day), with a global daily token cap as kill-switch
  (see [ADR-0005](./adr/0005-model-routing-groq-primary-gemini-fallback.md)).
- Drop Langfuse if OTLP export from workerd proves flaky — keep the `onStepFinish` audit log as
  the observability floor.
- MCP App (rich UI inside external MCP hosts) is stretch-only; it never blocks any phase.

## Top risks

Condensed from the planning brief's risk register — top 5, one line each:

1. AI SDK v6 approval API churn (Phase 5): `toolApproval` is current and `needsApproval` is
   deprecated; policy is kept separate from mechanism in
   [ADR-0003](./adr/0003-hitl-approval-gates-on-write-tools.md), with a hand-rolled approval state
   machine as fallback.
2. MCP transport/spec churn on Workers (Phase 6): vendored tool definitions and the
   skip-public-server threshold above cap the blast radius.
3. Free-tier model quota exhaustion: Groq's limits (30 RPM / 1K RPD / 12K TPM / 100K TPD) can
   starve a live demo — mitigated by Gemini Flash fallback, the global token cap, and a graceful
   "demo budget reached" state.
4. OTLP export instability on workerd (Phase 10): observability degrades to the `onStepFinish`
   audit log rather than blocking the phase.
5. Vapor instability on the Vue 3 (3.6-track) beta line (Phase 12): deferred behind a feature flag
   on a single leaf component; the app never depends on it.
