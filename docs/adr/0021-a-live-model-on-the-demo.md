# ADR-0021: A live model on the demo, and what the scripted mock had been hiding

- Status: Accepted; the Gemini fallback was removed by [ADR-0026](0026-groq-only-on-the-public-demo.md)
- Date: 2026-10-22
- Deciders: repo owner (solo project)

## Context and Problem Statement

The demo ran the scripted mock from its first deploy (ADR-0019). Switching it to Groq with the
Gemini fallback (ADR-0005) was meant to be a one-line change plus two secrets. Before making the
change, the six scenarios were run against the live models with the repo's own live-eval path.
That surfaced six problems, every one invisible while the mock answered:

1. **Both configured models were retired.** Groq no longer serves `llama-3.3-70b-versatile`.
   Google answers `gemini-2.5-flash` with "no longer available to new users", although the model
   list still includes it. The one-line switch would have sent every turn to a dead model and
   then to a dead fallback.
2. **The live evals had never run.** `EVAL_MODEL_PROVIDER=groq` was documented (ADR-0015), but
   the eval file never passed provider keys into the Worker env it builds. Every scenario failed
   before any model was called.
3. **A tool description contradicted its scenario.** `create_release_notes` said "use when the
   user asks to draft or save release notes", so a live model asked to _draft_ them saved them,
   and skipped the diff S-A turns on. The mock routes by regex and never reads descriptions.
4. **The prompt asked for markdown that the chat doesn't render.** Chat text is plain text by
   design (ADR-0016). A live model's `**bold**` and pipe tables would have reached visitors as
   raw characters.
5. **The eval harness answered only one round of approvals.** A model that asks for writes one at
   a time, which the SPA handles by showing the next card, looked as if it stopped after the first.
6. **Several eval assertions were the mock's own sentences** ("8 of 31 points done", "Did you mean
   DS-7"). A live model words things its own way, and writes "DS‑7" with a non-breaking hyphen.

## Decision

- **Models.**
  - **Groq `openai/gpt-oss-120b`** is primary. On the live scenarios it beat Groq's only other
    tool-calling model, `qwen/qwen3.8-27b`, which was slower, rate-limited sooner, and dropped
    writes.
  - **Gemini `gemini-3.8-flash`** is the fallback, the model Google's error names as the
    replacement.
  - The live demo runs `MODEL_PROVIDER=auto`. The keys are Worker secrets, and with no keys `auto`
    still falls back to the mock, so a fresh clone needs none.
- **The tool descriptions and prompt say what the product does.**
  - Drafting release notes means composing them and showing the diff. `create_release_notes` is
    for saving what the user saw.
  - "On track?" names the sprint's blockers, which the burndown series cannot.
  - Writes are requested in one step.
  - Answers are plain text.
- **Evals have two tiers.**
  - Every model must meet each scenario's meaning, checked against normalized text: the right
    tools in order, nothing written before approval, the denial owned in the answer, the board
    ending right.
  - The mock must also produce its exact sentences and trajectories, so a regression in the mock
    can't hide behind a loose check.
  - S-E is the one place the tiers diverge in substance. A live model often checks DS-42 _before_
    writing and offers DS-7 straight as an approval card, which is what the system prompt asks for
    ("the approval card is the confirmation"). The scripted try → error → ask → second card
    choreography is required of the mock only.
- **Live runs are paced.** They pause 65 s between scenarios with longer timeouts, because the
  free tiers' per-minute token limits would otherwise decide which scenarios pass.

Final run in the production configuration (`EVAL_MODEL_PROVIDER=auto`): see the status note below.

## Consequences

- Positive: the demo answers free-form questions, and every write is still behind an approval card,
  so a model's mistakes stay proposals.
- Positive: the live-eval path works, and it has already paid for itself with the six findings
  above.
- Negative: **the free tiers are the capacity limit.**
  - Groq allows 8,000 tokens a minute for gpt-oss-120b, and one agent turn spends about 2,000. A
    busy minute falls through to Gemini.
  - `gemini-3.8-flash` itself returns "high demand" 503s at times, and then the visitor gets an
    error turn.
  - The daily token cap (ADR-0016) still bounds the total.
- Negative: a live model is nondeterministic. One live-eval run is a sample, not a verdict, so
  these runs are a quality signal on demand, never a CI gate. CI stays on the mock.
- Neutral: the demo-video storyboard was rehearsed on the mock. It now names the two shots a live
  model plays differently.

## Alternatives Considered

- **Stay on the mock.** Deterministic and free, but visitors can only ask six questions, and the
  six findings above would have stayed hidden until someone switched.
- **`groq` with no fallback.** Simpler, but every rate-limited minute would become an error turn.
- **Loosen every eval assertion to fit the live model.** That would make the mock's regressions
  invisible. The two tiers keep both honest.
- **Render markdown safely in the chat.** Possible without `v-html`, but it is a feature. Asking
  for plain text matches what the chat already is.

## References

- [ADR-0005](0005-model-routing-groq-primary-gemini-fallback.md): the routing this updates
- [ADR-0015](0015-otlp-tracing-without-the-opentelemetry-sdk.md): the live-eval path that had
  never worked
- [ADR-0016](0016-two-spend-controls-and-an-honest-injection-posture.md): the spend controls, and
  why chat text is plain
- [docs/demo-video.md](../demo-video.md): the storyboard note

## Status note — 2026-10-22 (results)

These are samples, run on free tiers, in order:

| Run                                | Passed  | What failed, and why                                                                     |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `groq`, gpt-oss-120b, old prompt   | 5 / 9   | Rate limits, the S-A description bug, and mock-worded assertions                         |
| `groq`, qwen3.8-27b, old prompt    | 4 / 9   | Rate limits, timeouts, dropped writes                                                    |
| `groq`, gpt-oss-120b, fixed prompt | 6–7 / 9 | Groq's 8K tokens/minute during multi-write scenarios, and S-D before the "on track" rule |
| `gemini`, gemini-3.8-flash         | 6 / 9   | 503 "high demand", and one mock-worded assertion, since fixed                            |
| `auto` (production config)         | 7 / 9   | S-A and S-B: Groq rate-limited mid-scenario, then Gemini's free quota was exhausted      |

Across the runs, every scenario has passed with a live model. Each remaining failure is capacity,
not behaviour: the model was doing the right thing when a provider refused the next request.

The binding constraint is the fallback's free quota. Google's own error reports
`generate_content_free_tier_requests, limit: 20` for gemini-3.8-flash, and this evaluation used
it up. Rate limits are per Google Cloud project and are listed at aistudio.google.com/rate-limit,
not in the public docs. A model with a larger free daily quota, or billing on the project, is the
remedy. The repo can't decide either, because both depend on the account.

## Status note — 2026-10-22 (formatting)

The plain-text prompt rule did not hold. On the live site, gpt-oss-120b still wrote `**bold**` and
bullets. ADR-0022 renders that safe subset instead, and the prompt now describes what renders.

## Status note — 2026-11-09 (Groq only)

One run of the trajectory evals against the production model, `groq` with `openai/gpt-oss-120b`,
on 2026-11-09 from 13:09 UTC (728 s, with the 65 s pause between cases). It is a sample: one run
of a model that does not answer the same way twice.

| Run                             | Passed | Model-driven cases | What failed                                           |
| ------------------------------- | ------ | ------------------ | ----------------------------------------------------- |
| `groq`, gpt-oss-120b, Groq only | 9 / 10 | 6 / 7              | S-B: 2 approval requests where the scenario expects 5 |

There are ten cases now: the off-topic scope case joined on 2026-11-08. Three of them are S-F
cases that check the workspace directly and never call the model, so the model's own share is
6 / 7. The runs above counted all nine cases of their day, S-F included. S-A, S-C (both cases),
S-D, S-E and the scope case passed.

S-B asks to mark every remaining open issue in Sprint 12 as done. The model asked to approve two
of the five, and the run did not record why it stopped there. The case fails at that count, so its
later checks did not run. In the six passing model-driven cases, no write ran without an approval.
