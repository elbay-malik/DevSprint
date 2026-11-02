# ADR-0026: Groq only on the public demo

- Status: Accepted
- Date: 2026-11-02
- Deciders: repo owner (solo project)

## Context and Problem Statement

The live demo fell back to Gemini on a free-tier key (ADR-0005, ADR-0021). The
[Gemini API terms](https://ai.google.dev/gemini-api/terms), effective March 23, 2026, say: "You may
use only Paid Services when making API Clients available to users in the European Economic Area,
Switzerland, or the United Kingdom." A public URL is open to those users. The terms also let Google
use free-tier prompts to improve its products, with human review, and they say not to submit
personal information to unpaid services. Visitors type into this chat freely.

## Decision

Remove Gemini: the provider, the fallback wrapper, the dependency and the deploy gate's handling of
its key. `MODEL_PROVIDER` takes `auto`, `groq` or `mock`, and `auto` stays the committed value, so a
fresh clone still runs on the mock. A Google key left on the Worker is ignored.

Paying for Gemini would also meet the terms, and it would keep the fallback. It was turned down
because ADR-0005's budget target is zero and the free tier's 20 requests a day never added much.

## Consequences

- Positive: the demo no longer sends visitors' messages to a service its terms rule out here.
- Negative: when Groq rate-limits at about 8K tokens a minute, or fails, the turn ends in an error
  rather than moving to another model. The demo video needs its takes spaced out.
- Groq's [Services Agreement](https://console.groq.com/docs/legal/services-agreement), last modified
  June 22, 2026, allows making its services available to end users and bars training on inputs and
  outputs. No paid-plan or regional condition turned up, but only part of that text was read word
  for word, and the Data Processing Addendum was not read. It also says its services are "not for
  consumer use", and it is unclear how that applies to a public demo. This is a reading of the
  terms, not legal advice.
- `GROQ_API_KEY` stays a Worker secret, and the deploy still refuses an existing api without it.

## Links

- [ADR-0005](0005-model-routing-groq-primary-gemini-fallback.md): the routing this changes
- [ADR-0021](0021-a-live-model-on-the-demo.md): the live model and its capacity limits
