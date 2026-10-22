# ADR-0015: OTLP tracing without the OpenTelemetry SDK, and evals against the scripted mock

- Status: Accepted
- Date: 2026-09-22
- Deciders: repo owner (solo project)

## Context and Problem Statement

Phase 10 asks for "Cloudflare-native OTLP export to Langfuse" and "trajectory evals pass for all 6
demo scenarios." It is the one phase [roadmap.md](../roadmap.md) marks **risky on workerd**, with a
staged fallback already written down: _"Drop Langfuse if OTLP export from workerd proves flaky —
keep the `onStepFinish` audit log as the observability floor."_

That risk is usually real. The OpenTelemetry JS SDK leans on `AsyncLocalStorage` for context
propagation, most exporters assume Node's `http`, and OTLP is normally protobuf — none of which
workerd is famous for handling well.

So this phase started with a measurement rather than a design. The findings below are what the
decision rests on; each was run inside a real `wrangler dev` against this repo's own Worker.

| Question                                  | Result                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| Does `AsyncLocalStorage` work here?       | Yes — available, and it survives an `await` boundary          |
| Can the Worker POST OTLP/HTTP JSON?       | Yes                                                           |
| Does Langfuse need protobuf?              | No — it documents OTLP/HTTP **JSON** with Basic auth          |
| Does the AI SDK drive an injected tracer? | Yes — `experimental_telemetry.tracer` on the `ToolLoopAgent`  |
| What does a real turn produce?            | `ai.streamText` → `ai.streamText.doStream` ×2 + `ai.toolCall` |
| Full chain agent → OTLP JSON → collector? | Yes — 28 KB, valid hex ids, correct `parentSpanId` links      |

The flagged risk did not materialise. One thing that did, though, is the reason this ADR exists.

**Context propagation is load-bearing, and getting it wrong fails silently.** The spike first
tracked span parentage with an explicit stack — the obvious way to avoid depending on OTel at all.
Every span came out as a **root**: a completely flat trace that still exported successfully, still
returned 200, and looked fine until someone tried to read it. `ai.streamText`'s callback returns
the stream before its children are created, so a stack has already popped by the time the tool call
and the second model call happen. Swapping the stack for `AsyncLocalStorage` produced the correct
tree. Both modes were kept side by side in the spike so the difference was measured rather than
assumed.

## Decision

**Trace with `AsyncLocalStorage` and a hand-written OTLP/HTTP JSON exporter, not the OpenTelemetry
SDK.** The AI SDK takes a `tracer` directly, so the only OTel machinery actually needed is the
`Tracer`/`Span` shape it calls and async context to parent spans correctly. That is roughly 150
lines and no new dependency, against an SDK plus a context manager plus an exporter in a runtime
where bundle size is a deploy constraint.

Three consequences follow:

- **Export is deferred, not awaited.** The chat route's response _is_ the stream, so the root span
  ends after the response has started. Export hooks the turn's completion and ships through
  `waitUntil` — the same plumbing [ADR-0013](0013-deployment-cancel-as-an-api-route.md) added for a
  deployment settling after the client has gone.
- **Failure to export is never failure to answer.** A tracing backend is not on the critical path
  of a demo. Export errors are logged and swallowed; the `onStepFinish` audit log stays exactly
  where it is, as the floor the roadmap asks for rather than something tracing replaces.
- **Tracing is off unless configured.** With no Langfuse keys the tracer is not installed at all,
  so local dev and CI keep running with no network and no accounts — the same posture the model
  routing already takes with its scripted mock (ADR-0005).

**Evals run against the scripted mock in CI, and against a real model only on demand.** The six
scenarios in [demo-scenarios.md](../demo-scenarios.md) carry concrete trajectory assertions — exact
tool-call order, "the denied write never mutates state", "the next call after the error is
`search_issues`". Those are assertions about _the application_: its gating, its recovery path, its
ordering. Against the scripted mock they are deterministic, free, and can gate every PR.

The honest limitation is stated rather than glossed: **an eval against the mock does not prove a
real model elicits that trajectory.** It proves the app honours it. The harness therefore takes a
provider, so the same assertions can run against Groq or Gemini when someone wants that evidence —
it just cannot live in CI, because it costs quota and a real model is not deterministic.

## Consequences

- Positive: the risky phase is de-risked by measurement, and the measurement is written down. The
  next person to wonder "why not just use the OTel SDK?" has the numbers and the flat-trace trap.
- Positive: no new runtime dependency, and nothing to keep compatible with a Workers-hostile
  exporter.
- Positive: the eval suite gates PRs, because it needs no key and no network.
- Negative: we own a `Tracer`/`Span` implementation. It only has to satisfy what the AI SDK calls,
  which is a small surface — but it is a surface that could drift when the SDK changes, and the
  tests pin it.
- Negative: no sampling, no baggage, no cross-service propagation. None is needed for one Worker,
  and reaching for the real SDK is the answer if any becomes needed.
- Negative: traces are only as truthful as the attributes the AI SDK emits. This adds nothing of
  its own beyond the workspace's identity, so a Langfuse trace reflects the SDK's view of a turn.
- Negative: a turn's trace is ~28 KB, dominated by `ai.prompt.tools` — the full tool JSON schemas,
  repeated in every model-call span, about 6.7 KB each time. On a six-step turn that is most of the
  payload. `recordInputs`/`recordOutputs` are the only knobs and they are all-or-nothing, so the
  choice is "prompts in the trace" or "a much smaller trace", not both.
- Negative: live Langfuse ingestion is unverified. The spike proved the workerd half against a local
  collector; the Langfuse half rests on their documented OTLP contract until someone runs it with
  real keys.

## Alternatives Considered

- **The full OpenTelemetry SDK plus `@opentelemetry/context-async-hooks` and an OTLP exporter** —
  rejected on cost, not on feasibility. `AsyncLocalStorage` works here, so it would probably run;
  it is simply a lot of dependency for a tracer the AI SDK will hand us a hook for.
- **Langfuse's own `LangfuseSpanProcessor`** — rejected for the same reason: it presumes the OTel
  SDK. Worth revisiting if this Worker ever needs real OTel semantics.
- **`TelemetryIntegration` lifecycle hooks instead of a tracer** — the AI SDK offers these, and they
  would avoid OTel shapes entirely. Rejected because the span tree would then be hand-built from
  lifecycle events, which is the flat-trace failure again, just written by us on purpose.
- **A hand-rolled tracer with an explicit parent stack, no `AsyncLocalStorage`** — rejected on the
  measurement above. It produces a flat trace that exports cleanly and is wrong.
- **Evals against a real model in CI** — rejected: non-deterministic, and it spends demo quota on
  every PR. Available on demand instead, which is where its value actually is.
- **Skip evals, keep only the audit log** — rejected. The scenarios are already written as
  assertions; not running them is leaving the acceptance criteria as prose.

## References

- [docs/roadmap.md](../roadmap.md) — Phase 10, and the "drop Langfuse if OTLP proves flaky" threshold
- [docs/demo-scenarios.md](../demo-scenarios.md) — the six scenarios and their eval assertions
- [ADR-0005](0005-model-routing-groq-primary-gemini-fallback.md) — the scripted mock the evals run against
- [ADR-0013](0013-deployment-cancel-as-an-api-route.md) — the `waitUntil` plumbing export reuses

## Status note — 2026-10-22

Two figures above drifted:

- `apps/api/src/agent/tracing.ts` is about 260 lines, roughly 190 without comments, not 150.
- "The same plumbing ADR-0013 added" means the `waitUntil` option `run_deployment` uses. ADR-0013's
  own text does not mention it.

Live Langfuse ingestion is still unverified: production runs the mock model, with no Langfuse
keys set.

## Status note — 2026-10-22 (live evals)

"`EVAL_MODEL_PROVIDER` runs the same assertions against a real provider on demand" was not true
until ADR-0021. The eval file never passed provider keys into the Worker env it builds, so every
live run failed before reaching a model. That's fixed now, and the assertions have two tiers: the
scenario's meaning for every model, and exact sentences for the mock.
