# ADR-0003: HITL approval gates on write tools

- Status: Accepted (policy; the SDK mechanism below is expected to churn and is non-binding)
- Date: 2026-07-08
- Deciders: repo owner (solo project)

## Context and Problem Statement

Every write tool mutates the shared demo workspace, and the live demo runs unattended in front of
reviewers, so unreviewed writes are both a product and a safety problem. The message history that
drives the agent loop arrives from the client and cannot be trusted: a forged history could claim
an approval that never happened. Meanwhile the AI SDK's approval surface has churned — the per-tool
`needsApproval` option is deprecated in favor of a `toolApproval` map (verified July 2026), and
there is an open bug on approvals in `createAgentUIStream` (vercel/ai #10196). The policy therefore
has to be stated independently of any particular SDK mechanism.

## Decision

Every write tool always requires human approval, rendered as an in-stream ApprovalCard, with no
exceptions and no batching — N implied writes mean N approval gates. The server must re-validate
the tool input and re-evaluate the approval policy before executing, regardless of what the
client-supplied history claims.

### Mechanism note (verified July 2026, non-binding)

AI SDK v6: `toolApproval` map on the ToolLoopAgent (statuses `not-applicable` / `approved` /
`denied` / `user-approval`); the client responds via `addToolApprovalResponse` with
`sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`. `needsApproval` is
deprecated but still functional.

## Consequences

- Positive: batch requests become individually visible gates — scenario S-B yields exactly 5
  ApprovalCards, including one scripted denial.
- Positive: server-side re-validation closes the forged-history hole; the client is a renderer,
  not an authority.
- Positive: separating policy from mechanism means Phase 5 implementation changes do not force a
  rewrite of this ADR.
- Negative: exact `ai` / `@ai-sdk/*` versions must be pinned; upgrades are deliberate events.
- Negative: a hand-rolled approval state machine must be kept as a fallback in case vercel/ai
  #10196 blocks the built-in flow.

## Alternatives Considered

- Per-tool `needsApproval` — rejected: deprecated API; would bake churn into the design.
- Client-side-only gating — rejected: trivially bypassed by editing message history.
- Auto-approving "low-risk" writes — rejected: no write is low-risk in a public shared demo, and
  the uniform rule is easier to reason about and to eval.

## References

- [docs/tool-inventory.md](../tool-inventory.md) — Section 3, approval policy per tool
- [docs/wireframes.md](../wireframes.md) — ApprovalCard anatomy and HITL sequence diagram
- vercel/ai issue #10196 — approvals in `createAgentUIStream`
- https://ai-sdk.dev/docs/agents/tool-approvals
