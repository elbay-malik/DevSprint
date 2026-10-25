# ADR-0023: Approve all, and undo an applied board write

- Status: Accepted
- Date: 2026-10-25
- Deciders: repo owner (solo project)

## Context and Problem Statement

The approval gate held to "one decision per change" (PRODUCT.md, principle 2): scenario S-B's
close-out raises five cards, and each needed its own Approve. The design critique of 2026-10-25
scored that against two of its personas. Its power user found "no 'review all' path. Five Approve
clicks, with about 20 tab stops to get through them by keyboard", and heuristic 7 (flexibility)
scored 2 for the same reason. Heuristic 3 (user control) scored 2 partly because "an approved
write cannot be undone": once a card was approved, the only way back was to ask the copilot for a
new write, or to reset the whole shared board. The owner decided to build both. The question this
ADR answers is how to do so without weakening what the gate exists to prove: every change is still
proposed, approved and recorded one by one, and the server, not the client, decides what a write
does.

## Decision

We will let the approval group header answer its open board writes in one press, through the same
per-card approval path, and we will let a person undo an applied `create_issue` or
`update_issue_status` from its card through a new `POST /api/workspace/undo { changeId }` route.
The undo applies an inverse the workspace recorded as the write landed, and it refuses whenever
the board has moved on.

**Approve all** (apps/web, `approveAllPlan` in `features/chat/lib/approvals.ts`):

- It is offered on the last message only, since the SDK answers approvals against the last
  message, and only when two or more open cards qualify (`APPROVE_ALL_MIN`). The label is "Approve
  all 5", or "Approve remaining 4" once a card in the group was answered on its own.
- Only `update_issue_status` for a key the board holds and `create_issue` qualify. A status change
  for a key the board does not hold (the S-E case, where the card makes Deny the default),
  `create_release_notes` and `run_deployment` are left out, and a line under the header names them
  ("DS-42 needs its own decision."). The button's count is exactly what it answers.
- The press calls `addToolApprovalResponse` once per card, each with its own single-use approval id
  and its own recorded time and "from" status, so every card keeps its own record line and the
  server sees N ordinary approvals. Nothing about the api's gate changed.
- While it is shown it holds the message's one Ink, and every card decides in outline, including a
  missing-key card's Deny. The status line says the press once, when its last card has turned ("4
  changes approved by you at 14:05.").

**Undo** (apps/api, `workspace/changes.ts`):

- `create_issue` and `update_issue_status` now record their before and after in the workspace
  Durable Object as they land, whichever client made them, and their results carry a `changeId`
  the workspace mints (`crypto.randomUUID()`). The record is keyed by that id rather than the SDK's
  tool call id because the issue writes usually arrive over MCP (ADR-0002), and the MCP hop carries
  the arguments, not the call id.
- The route takes only `{ changeId }`. The before-state comes from the workspace's own record,
  never from the client: the previous status, with its completion time and blocked reason, or the
  created issue removed. The fields recorded and compared are status, assignee, blocked reason and
  completion time.
- It is one-shot and conflict-safe. It refuses with `409 UNDO_CONFLICT` when the issue no longer
  reads exactly what the write left, when the change was already undone, or when there is no
  record of it (a reset clears them all). A malformed or oversized id (over 64 characters, the
  same bound as `MAX_APPROVAL_ID_LENGTH`) is a `400 INVALID_INPUT`. Undoing the later change first
  brings the issue back to what the earlier one left, so a chain still unwinds in order.
- The journal is saved in the same storage `put` as the board, so the two cannot disagree, and it
  is capped at 300 entries, oldest out first (about 390 KB in the worst case). It clears on reset
  with the board. Each undo is logged as one JSON line beside the agent's step log.
- Like reset (ADR-0014) and cancel (ADR-0013), it is an api route and not a tool. It is a person's
  action in the SPA, and the copilot re-reads the board through its tools before it answers, so
  its transcript not hearing about the undo is acceptable.

On the card, an applied write whose result carries a `changeId` gets a ghost Undo after its record
line. Success reads "↶ Undone by you at 14:05 — DS-9 back to In progress." (or "— DS-14 removed
from the board."), the board re-reads, and the restored card takes its changed-card ring. A
refusal reads in the board's words through the error-copy mapping ("That change to DS-9 can’t be
undone: the board has moved on."). Both are announced on the transcript's status line. A network
failure shows a toast, as other failed board requests do, and keeps the Undo for another try.

## Consequences

- Positive: S-B's close-out takes one press after the denial instead of four, and the keyboard
  path drops from about twenty stops to one. Each change is still its own signed, single-use
  approval and its own record line, so the audit trail reads the same as before.
- Positive: an approved mistake can be taken back without resetting the board for everyone, and
  the undo cannot be used to write arbitrary state: at most it reverses a write that really
  happened, once, while the issue still reads what that write left.
- Positive: the before-state is recorded for writes from outside MCP hosts too, so the record is
  complete whichever client wrote, even though only the SPA offers the button.
- Negative: principle 2 is no longer "one decision per change". PRODUCT.md now says what still
  holds: one proposal and one record per change, with a reviewed batch approvable in one go.
- Negative: the undo route is open, like reset, on the shared public board. Anyone who learns a
  change id can undo that change. That is less than Reset already allows, and the id is never
  shown in the UI.
- Negative: `create_release_notes` and `run_deployment` cannot be undone, and `assign_issue` is
  not a tool (tool-inventory §4), so it has no inverse yet. If a reassigning write is added, it
  should record itself through the same journal; the journal already compares the assignee, so a
  status undo refuses over a reassignment today.
- Negative: an undo made over a stale board (another visitor or an MCP host moved the issue) is
  refused rather than merged. That is deliberate, and the refusal copy says so in one sentence.

## Alternatives Considered

- One batch card in place of N cards — rejected: it would replace N signed approvals with one, and
  S-B's success criteria require five separate cards.
- Undo from client-supplied before-values — rejected: the route would then write whatever a
  client sent, which is a write with no approval.
- An `undo_change` MCP tool — rejected: the undo is a person's action on the board, like reset;
  making it a tool would route it through a model and a second approval.
- Keying the record by the SDK's tool call id — rejected: that id does not cross the MCP hop, so an
  MCP write could not be found again.
- Forcing the inverse over a later change — rejected: it would silently overwrite that change.

## References

- [ADR-0003](0003-hitl-approval-gates-on-write-tools.md), approval policy;
  [ADR-0010](0010-tool-approval-mechanism-and-replay-protection.md), the single-use approval id.
- [ADR-0013](0013-deployment-cancel-as-an-api-route.md) and
  [ADR-0014](0014-daily-reset-alarm-and-a-persisted-approval-ledger.md), the other routes that are
  not tools.
- `apps/api/src/workspace/changes.ts`, `apps/api/src/index.ts` (the undo route),
  `apps/api/README.md`.
- `apps/web/src/features/chat/lib/approvals.ts`, `apps/web/src/features/chat/lib/undo.ts`.
- The design critique of 2026-10-25 (`.impeccable/critique/`), Persona Red Flags and heuristics 3
  and 7.
