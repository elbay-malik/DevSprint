# ADR-0010: Tool approval mechanism and replay protection

- Status: Accepted
- Date: 2026-09-05
- Deciders: repo owner (solo project)

## Context and Problem Statement

[ADR-0003](0003-hitl-approval-gates-on-write-tools.md) fixed the policy — every write is gated,
one approval per mutation, and a forged **or replayed** approval must never execute a write — and
deliberately left the mechanism open, flagging that the SDK surface was churning. Phase 5 has to
pin the mechanism down against the version actually installed.

Two of ADR-0003's mechanism claims turn out to be wrong for `ai@6.0.277`, and the same wrong claims
had been copied into [tool-inventory.md](../tool-inventory.md) §3 as a normative instruction ("do
not use it in new code"). There is no `toolApproval` map in the package, and `needsApproval` is not
deprecated — it is the only gate. Following the old text would have meant hunting for an API that
does not exist while rejecting the one that does.

The security requirement also needs more than the SDK provides. The SDK signs approval requests,
which stops forgery, but the signed payload carries no nonce and no expiry, so one captured
approval verifies forever: replaying a single valid approval was measured executing the same write
three times.

## Decision

We will gate writes with `needsApproval: true` per tool, sign every approval request with
`experimental_toolApprovalSecret`, and add our own one-time-use ledger of approval ids so a
replayed approval is downgraded to a denial rather than applied a second time.

The secret is never optional: an unset `TOOL_APPROVAL_SECRET` falls back to a random per-isolate
secret with a warning rather than running unsigned, because unsigned approvals fail open and look
perfectly healthy in a demo.

The ledger burns only approvals whose call has not yet produced a result. Answered approvals stay
in the transcript forever, so burning those instead would reject every later message in the
conversation.

## Consequences

- Positive: a fabricated approval is rejected by signature, and a captured one is refused by the
  ledger, so ADR-0003's requirement is met in full rather than half.
- Positive: the policy lives in the tool definition, and the SDK re-evaluates it on resume — if
  policy later says a call no longer needs approval, a claimed approval is converted to a denial
  rather than auto-executing.
- Negative: the ledger is in-memory and therefore per-isolate. On Workers this bounds replay within
  an isolate, not globally; D1 (Phase 9) is where it has to live for the guarantee to be real. (It
  now lives in the workspace Durable Object instead — not D1, which
  [ADR-0011](0011-workspace-state-in-a-durable-object.md) had already ruled out by the time Phase 9
  landed — behind `WorkspaceApi.spendApprovals`; see
  [ADR-0014](0014-daily-reset-alarm-and-a-persisted-approval-ledger.md).)
- Negative: a resume that fails after its approvals are spent cannot be retried — those approvals
  now read as denials and the user must ask again. Deliberate: silently accepting the retry is
  exactly the replay we are refusing. Rejecting the whole request instead would be worse, because
  answered approvals stay in the client's transcript and every later message would carry them,
  stranding the conversation for good.
- Negative: an ephemeral secret does not survive a restart, so approvals issued before a local
  reload stop verifying. Acceptable in dev, which is why deploys must set the secret.
- Negative: signature failures surface asynchronously into the stream rather than as a throw, so
  error handling has to sit in `toUIMessageStreamResponse({ onError })`. A `try`/`catch` around the
  agent call silently misses them.

## Alternatives Considered

- Trusting the SDK signature alone — rejected: it covers forgery but not replay, and ADR-0003 names
  both.
- Failing closed (503) when no secret is configured — rejected: it would break keyless local dev and
  CI, which are the only ways this demo runs today.
- Forcing one gated call per model step so approvals arrive one at a time — rejected: it costs an
  extra model round-trip per write on a free tier, and the policy is satisfied by N separate calls
  and N separate cards regardless of how many arrive together.

## References

- [ADR-0003](0003-hitl-approval-gates-on-write-tools.md) — the policy this implements
- [docs/tool-inventory.md](../tool-inventory.md) §3 — approval policy, mechanism paragraph corrected
- [docs/demo-scenarios.md](../demo-scenarios.md) — S-B, and its Phase 5 choreography note

## Status note — 2026-10-22

"Keyless local dev and CI are the only ways this demo runs" no longer holds. Production has run
since 2026-10-21, and `scripts/deploy.ts` sets `TOOL_APPROVAL_SECRET` on the first deploy, so the
random per-isolate fallback is reached only locally (ADR-0019).
