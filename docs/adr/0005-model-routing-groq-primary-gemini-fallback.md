# ADR-0005: Model routing — Groq primary, Gemini Flash fallback

- Status: Accepted
- Date: 2026-07-08
- Deciders: repo owner (solo project)

## Context and Problem Statement

The demo must stay within ≤ 5 EUR/month (target 0) while remaining publicly reachable, which rules
out providers without a durable free tier. Per the brief (June 2026), Groq's free tier for
`llama-3.3-70b-versatile` allows 30 RPM / 1K RPD / 12K TPM / 100K TPD — enough for a portfolio demo
with scripted scenarios, and the model handles tool calling. Gemini Flash retains a usable free
quota (despite the December 2025 quota cuts) and serves as a second leg on a different provider. A
public demo also needs a hard stop: without a global cap, one crawler or one enthusiastic reviewer
can burn the daily budget and leave the demo broken mid-conversation.

## Decision

We will route to Groq `llama-3.3-70b-versatile` as primary and Gemini 2.5/3 Flash as fallback, with
a global daily token cap acting as a kill-switch that degrades the app into a graceful "demo budget
reached" state instead of surfacing provider errors.

## Consequences

- Positive: zero-cost happy path; quota exhaustion produces a designed state, not a broken chat.
- Positive: the fallback path exercises the AI SDK provider abstraction — itself a portfolio
  signal.
- Negative: Groq tool-selection quality is unproven for this tool set; if it is weak, swap the
  primary to `gpt-oss-120b` on Groq before touching the routing design.
- Negative: two providers to monitor, and the routing/cap logic is real code that needs tests.
- Negative: Workers AI (10k Neurons/day) is held as an emergency-only third leg, adding a rarely
  exercised code path.

## Alternatives Considered

- Anthropic or OpenAI direct — rejected: no durable free tier; violates the budget constraint.
- Workers AI as primary — rejected: weaker tool-calling model quality; kept for emergencies only.
- Single provider, no fallback — rejected: one quota incident takes down the live demo.

## References

- [docs/product-brief.md](../product-brief.md) — success criteria and budget
- [docs/roadmap.md](../roadmap.md) — staged thresholds (fallback triggers at 1K RPD / 100K TPD)

## Status note — 2026-10-22

Four points this ADR does not say:

- **The keyless scripted mock and `MODEL_PROVIDER`** (`auto | groq | gemini | mock`) were added at
  Phase 3, so dev, CI and the evals never need a key (`apps/api/src/agent/model.ts`).
- **The daily token-cap kill-switch was deferred to Phase 11.** It lives in the workspace Durable
  Object, because Cloudflare's rate-limit binding is not an accounting system (ADR-0016).
- **The Workers AI emergency leg was never built.**
- **The live demo currently runs `MODEL_PROVIDER=mock`** (`apps/api/wrangler.jsonc`). Groq and
  Gemini serve only when keys are set and that line changes (ADR-0019).

## Status note — 2026-10-22 (live)

Both models named above have been retired by their providers. Groq dropped
`llama-3.3-70b-versatile`, and Google refuses `gemini-2.5-flash` to new keys. The routing stands.
The models are now Groq `openai/gpt-oss-120b` and Gemini `gemini-3.8-flash`, chosen on live
scenario runs, and the demo runs `auto` (ADR-0021).

## Status note — 2026-10-25

The roadmap reference above says the fallback triggers at 1K RPD / 100K TPD. It doesn't: those
figures were the retired llama model's free-tier limits, and nothing counts requests or tokens to
switch early. A Groq call goes to Gemini only after it fails with a rate-limit, quota or server
error (`shouldFallback` in `apps/api/src/agent/fallback-model.ts`).
