# ADR-0013: Deployment cancel as an api route, not the request's abort signal

- Status: Accepted (amended by ADR-0024)
- Date: 2026-09-06
- Deciders: repo owner (solo project)

## Context and Problem Statement

Phase 8's deploy runs for about eleven seconds across four stages, and scenario S-C variant C2 says
the user can cancel it mid-run and end up with a deployment recorded as `cancelled` — not one still
reading `running`, and not one that quietly finished anyway.

[docs/tool-inventory.md](../tool-inventory.md) §4 planned this the obvious way: no cancel tool,
because `run_deployment` would watch the request's `abortSignal`. The SDK passes that signal into
every tool's `execute`, the Worker takes it from `c.req.raw.signal`, and stopping the turn aborts
the `fetch`. Phase 4 had already proved the signal ends the agent loop, so the mechanism looked
settled.

It does not work. Instrumenting the abort listener inside `run_deployment` showed it never firing on
a client disconnect: a browser that stops reading a streamed response does not reliably abort the
request on the Worker side. The deploy ran to `succeeded` in the workspace while the card said it
had been cancelled — the exact disagreement between the card and the board that C2 exists to catch,
and a demo that lies about having stopped something is worse than one with no cancel at all.

## Decision

Cancel is `POST /api/deployments/:id/cancel`. It writes the terminal status to the workspace, and
the deploy loop reads the workspace between stages rather than watching a signal.

Three things follow from that:

- **The workspace is the cancellation channel.** `run_deployment` already persists every stage as it
  happens, and each write returns the current deployment, so the loop learns it was cancelled from
  the next write it makes. No polling and no extra read.
- **A settled deployment is immutable**, enforced in both mutations. Cancelling is a race by nature —
  the request lands mid-stage — so `setDeploymentStage` refuses a settled run, or the loop's next
  write would reopen a stage on a deployment already cancelled; and `finishDeployment` refuses one
  too, or whichever of the cancel and the run's own closing write went last would win. Losing that
  race in one direction discards a cancel the user was told had landed, and in the other rewrites a
  release that shipped.
- **The turn is left running.** Cancel does not abort the request, so the run's last stream frame is
  the cancelled deployment and the model gets to say what happened.

The abort-signal path stays as a second trigger. It is what fires when the server-side loop really
is torn down, and it costs one listener.

## Consequences

- Positive: cancel is real. The board, the card and the model agree, and the e2e test asserts
  against the stored deployment rather than the pixels.
- Positive: cancellation no longer depends on a client's disconnect behaviour, which differs across
  browsers, proxies and the workerd/production split.
- Positive: because the workspace is the channel, anything else that ends a run — a future timeout,
  an operator, a second tab — stops it too, without new plumbing.
- Negative: one more public route. It returns 404 rather than inventing a deployment to cancel, and
  409 rather than reporting success for a run that already finished. It has no auth: anyone who can
  reach the api can cancel any running deployment, which is acceptable only because the workspace is
  a shared demo board that resets — it is not a model for a real deploy control plane.
- Negative: the run persists the whole workspace on every stage step (sixteen writes per deploy),
  because [ADR-0011](0011-workspace-state-in-a-durable-object.md) stores it under one key. That is
  what makes a cancelled run recoverable at all, and it is affordable at demo scale, but it is the
  first thing to revisit if the workspace grows.
- Negative: cancellation is granular to a stage boundary, not instant. A stage's sleep still runs to
  completion, so the run stops within a stage rather than immediately. Given stages of two to four
  seconds, that is not worth a finer-grained mechanism.
- Negative: [tool-inventory.md](../tool-inventory.md) §4's stated mechanism is now wrong; it is
  updated to point here.

## Alternatives Considered

- **The abort signal, as originally planned** — rejected on the measurement above: the listener
  never fires on client disconnect, so the run finishes while the card claims it stopped.
- **A `cancel_deployment` tool** — rejected. The cancel comes from a button, so routing it through
  the model would make whether the deploy stops depend on the model deciding to call a tool. It also
  could not be reached at all while the turn is mid-tool-call, which is exactly when it is needed.
- **A Durable Object alarm or WebSocket to push the cancel** — rejected as more machinery than a
  demo-scale deploy needs, when the workspace the loop already writes to on every stage will carry
  the message for free.
- **Accept the limitation and drop mid-run cancel** — rejected: C2 is a scenario the product brief
  sells, and "the button is decorative" is not a thing to ship.

## References

- [docs/tool-inventory.md](../tool-inventory.md) §4 — the mechanism this replaces
- [docs/demo-scenarios.md](../demo-scenarios.md) — scenario S-C and variant C2
- [docs/roadmap.md](../roadmap.md) — Phase 8
- [ADR-0011](0011-workspace-state-in-a-durable-object.md) — the workspace this cancel writes to
