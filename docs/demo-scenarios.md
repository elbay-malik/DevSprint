# Demo scenarios

These six scripted scenarios are the product's acceptance spec. They double as the Phase 10
trajectory-eval suite and the Phase 13 Playwright E2E spec: each "eval assertions" block below is
meant to be transcribed 1:1 into eval checks and E2E expectations, not reinterpreted.

All scenarios run against the deterministic seed defined in [domain-model.md](./domain-model.md) at
the fixed demo clock `WORKSPACE_NOW = 2026-07-01T09:00:00Z`. Each scenario except S-F, which runs
in an external MCP host, has a one-click suggestion in the empty transcript, above the composer. It
is labelled by its outcome ("Close out the sprint") and sends the scenario's verbatim step-1
prompt below (`apps/web/src/features/chat/lib/suggestions.ts`, checked against this file by its
unit test). The suggestions go once the conversation starts; later prompts are typed. S-F's place
is taken by the MCP endpoint, which the same empty state shows with a copy button.

Current repo status: Phases 0–14 are implemented and deployed (ADR-0019). The live site runs a
real model (`MODEL_PROVIDER=auto`: Groq `openai/gpt-oss-120b`,
ADR-0021, ADR-0026), so a reviewer there sees each scenario's meaning but not always the exact trajectory
below. The step tables describe the scripted mock, which CI uses, and ADR-0021's two eval tiers say
which parts every model must meet. Every scenario
runs end to end against the scripted mock model in two suites that transcribe its "Eval
assertions" block: the trajectory evals (`apps/api/src/evals/scenarios.eval.test.ts`) and the
browser specs (`apps/web/e2e/scenarios.spec.ts`), which also assert what the page drew, what the
browser was streamed and what the workspace Durable Object stored. S-F is driven in the browser
suite by the stock MCP SDK client standing in for the external host; the scenario as written also
needs a real host; its other precondition, the deployed server, is live at
`https://mcp.devsprint.elbaymalik.com/mcp`.

Expected-UI details that are **not built**, marked where they appear: the workspace pane's Sprint
and Deploys tabs, the release-notes badge, full markdown in
chat text (S-A step 4: a safe subset renders since ADR-0022, without `v-html` and without links,
and the draft itself is readable in the diff card), and a distinct "interrupted" state
for the stage a cancel lands in (S-C C2: that stage reads `skipped`, the same as an unreached one).
The "first fully runnable phase" field on each scenario says when it lit up; see
[roadmap.md](./roadmap.md).

Conventions used in the step tables:

- Tool names and key arguments are exact (they match [tool-inventory.md](./tool-inventory.md)).
- "Stream parts" are described generically (text, tool call/result, approval request part,
  progress data parts) — the exact AI SDK part type names are an implementation detail of Phase 5.
- "Workspace pane" is the left pane (five-column board: Todo / In Progress / In Review / Blocked /
  Done, with the backlog below it; the Sprint and Deploys tabs are not built); "chat pane" is the
  right pane. See
  [wireframes.md](./wireframes.md).

---

## S-A — Sprint summary → release-notes draft with diff

- **ID:** S-A
- **Goal:** show multi-step tool chaining that ends in a rich generative-UI card (the diff), then a
  gated write. The agent chains 3 tools to reach the ReleaseNotesDiff card; the save is a 4th,
  gated call.
- **First fully runnable phase:** Phase 7 (the tool chain plus approval already works at Phase 5
  with the fallback tool-chip JSON rendering; the ReleaseNotesDiff card lands in Phase 7).
- **Preconditions:** fresh seed; `rn-1` (v1.4.2, published) is the latest published release note;
  DS-5 and DS-6 are the only `done` issues in `sprint-12`.

| Step | Actor | Action or prompt (verbatim)                               | Expected tool call                                             | Expected stream parts    | Expected UI (workspace / chat)                                                                                                                       |
| ---- | ----- | --------------------------------------------------------- | -------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | User  | "Summarize Sprint 12 and draft release notes for v1.5.0." | —                                                              | —                        | Chat: user message appears                                                                                                                           |
| 2    | Agent | Reads sprint health                                       | `get_sprint_status({ sprintId: 'sprint-12' })`                 | tool call + result       | Chat: tool chip; streamed summary text (8/31 points done, DS-11 blocked)                                                                             |
| 3    | Agent | Lists completed work                                      | `list_issues({ sprintId: 'sprint-12', status: 'done' })`       | tool call + result       | Chat: IssueTable with DS-5, DS-6                                                                                                                     |
| 4    | Agent | Composes v1.5.0 draft markdown from DS-5/DS-6 (no tool)   | —                                                              | text                     | Chat: draft streams as text; its headings, bullets and bold render as the safe subset (ADR-0022), and links stay literal — see the status note above |
| 5    | Agent | Diffs draft vs last published                             | `diff_release_notes({ draftMarkdown, baseVersion: 'v1.4.2' })` | tool call + result       | Chat: ReleaseNotesDiff card, before/after vs rn-1                                                                                                    |
| 6    | User  | "Looks good, save it."                                    | —                                                              | —                        | Chat: user message                                                                                                                                   |
| 7    | Agent | Requests the gated save                                   | `create_release_notes({ version: 'v1.5.0', markdown })`        | approval request part    | Chat: ApprovalCard (pending)                                                                                                                         |
| 8    | User  | Clicks Approve                                            | (tool now executes)                                            | tool result + final text | Chat: ApprovalCard resolved + confirmation text. (The "v1.5.0 draft" badge in the workspace pane is **not built** — no phase owns it)                |

**Success criteria**

- The diff card renders before any approval is requested; the draft is only persisted after
  explicit approval.
- The saved release note has `status: 'draft'` and version `v1.5.0`.

**Eval assertions**

- Tools called in exactly this order: `get_sprint_status` → `list_issues` →
  `diff_release_notes` → `create_release_notes`.
- `create_release_notes` never executes without a prior approval response.
- The composed markdown mentions both DS-5 and DS-6.

---

## S-B — Batch write with per-issue approval gates

- **ID:** S-B
- **Goal:** demonstrate the HITL policy under a batch request — one approval PER issue, never one
  batch card — including a denial that the agent must respect and report.
- **First fully runnable phase:** Phase 5.
- **Preconditions:** fresh seed; `sprint-12` has exactly 5 non-done issues: DS-7 (in_review), DS-8
  (in_review), DS-9 (in_progress), DS-10 (in_progress), DS-11 (blocked). The seed is tuned so this
  scenario yields exactly 5 approval gates.

| Step | Actor        | Action or prompt (verbatim)                                                              | Expected tool call                                           | Expected stream parts                   | Expected UI (workspace / chat)                                                                                                                               |
| ---- | ------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | User         | "We're closing Sprint 12 today — mark every remaining open issue in the sprint as done." | —                                                            | —                                       | Chat: user message                                                                                                                                           |
| 2    | Agent        | Enumerates open issues                                                                   | `list_issues({ sprintId: 'sprint-12' })`                     | tool call + result                      | Chat: IssueTable of the 5 open issues; the agent moves straight on to the writes, leaving the count to the table                                             |
| 3    | Agent        | Requests close of DS-7                                                                   | `update_issue_status({ issueKey: 'DS-7', status: 'done' })`  | approval request part                   | Chat: ApprovalCard #1                                                                                                                                        |
| 4    | User         | Approves DS-7                                                                            | (executes)                                                   | tool result                             | Workspace: DS-7 moves In Review → Done                                                                                                                       |
| 5    | Agent + User | Same for DS-8 (approve)                                                                  | `update_issue_status({ issueKey: 'DS-8', status: 'done' })`  | approval request part, then tool result | Workspace: DS-8 moves In Review → Done; chat: ApprovalCard #2 resolved                                                                                       |
| 6    | Agent + User | Same for DS-9 (approve)                                                                  | `update_issue_status({ issueKey: 'DS-9', status: 'done' })`  | approval request part, then tool result | Workspace: DS-9 moves In Progress → Done; chat: ApprovalCard #3 resolved                                                                                     |
| 7    | Agent + User | Same for DS-10 (approve)                                                                 | `update_issue_status({ issueKey: 'DS-10', status: 'done' })` | approval request part, then tool result | Workspace: DS-10 moves In Progress → Done; chat: ApprovalCard #4 resolved                                                                                    |
| 8    | Agent        | Requests close of DS-11                                                                  | `update_issue_status({ issueKey: 'DS-11', status: 'done' })` | approval request part                   | Chat: ApprovalCard #5                                                                                                                                        |
| 9    | User         | DENIES with reason "Still blocked on vendor sandbox"                                     | (never executes)                                             | denial response part                    | Workspace: DS-11 stays in Blocked; chat: ApprovalCard #5 records "Denied by you at <time>: “Still blocked on vendor sandbox”." under "DS-11: Blocked → Done" |
| 10   | Agent        | Acknowledges the denial and summarizes                                                   | —                                                            | final text                              | Chat: a takeaway, not a list — "4 of the 5 issues are now Done", and DS-11 was not approved                                                                  |

**Success criteria**

- Exactly 5 separate ApprovalCards render (never a single batch card).
- Nothing is written until a card is answered, and DS-11 never leaves the Blocked column.

> **Choreography note (Phase 5).** The step table above reads as a strict alternation of card and
> execution. The scripted mock asks for all five writes in one step (a live model may ask one card
> at a time, ADR-0021), so the five cards appear
> together and the approved writes execute once the last card is answered — the board therefore
> updates in one go rather than card by card. The policy the scenario exists to prove is
> unchanged: five separate calls, five separate approvals, no batch card, and the denial honoured.
>
> **Approve all (ADR-0023).** Once DS-11 is denied, the group header offers "Approve remaining 4",
> which answers DS-7 to DS-10 in one press. It sends four separate approvals, so every card keeps its
> own record line; the step table keeps the per-card path, and `scenarios.spec.ts` follows it.

**Eval assertions**

- Exactly 5 approval requests are emitted, one per issue key DS-7, DS-8, DS-9, DS-10, DS-11.
- The denied `update_issue_status` call for DS-11 never mutates workspace state.
- The agent's final text mentions the denial (and does not claim 5 issues were closed).

---

## S-C — Long-running deployment with live progress

- **ID:** S-C
- **Goal:** show a long-running write tool that streams multi-stage progress into a live card and
  supports mid-run cancellation.
- **First fully runnable phase:** Phase 8.
- **Preconditions:** fresh seed; no deployment currently running; v1.5.0-rc.1 not previously
  deployed. Latest staging deploy in history is dep-4 (v1.4.2, succeeded).

| Step | Actor  | Action or prompt (verbatim)                                             | Expected tool call                                                   | Expected stream parts                                            | Expected UI (workspace / chat)                                                                                                                   |
| ---- | ------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | User   | "Deploy v1.5.0-rc.1 to staging."                                        | —                                                                    | —                                                                | Chat: user message                                                                                                                               |
| 2    | Agent  | Optional pre-check of last staging deploy                               | `get_deployment_history({ environment: 'staging', limit: 1 })`       | tool call + result                                               | Chat: tool chip with dep-4 (v1.4.2, succeeded)                                                                                                   |
| 3    | Agent  | Requests the deployment                                                 | `run_deployment({ environment: 'staging', version: 'v1.5.0-rc.1' })` | approval request part                                            | Chat: ApprovalCard                                                                                                                               |
| 4    | User   | Clicks Approve                                                          | (job starts)                                                         | preliminary tool results                                         | Chat: DeploymentProgressCard appears                                                                                                             |
| 5    | System | Stages stream: build (~3s) → test (~4s) → migrate (~2s) → release (~2s) | (same call, streaming)                                               | one preliminary result per stage step, each a whole `Deployment` | Chat: stage rows flip pending → running → succeeded, progress bar advances, log lines tail                                                       |
| 6    | System | Deployment finishes                                                     | (final tool result)                                                  | tool result + final text                                         | Chat: card shows "succeeded". (The Deploys tab is **not built** — no phase owns it; `get_deployment_history` is how a deploy is read back today) |

**Variant C2 — cancellation**

| Step | Actor                                                                           | Action or prompt (verbatim)                                          | Expected tool call      | Expected stream parts                          | Expected UI (workspace / chat)                                              |
| ---- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| C2-1 | Steps 1-4 as above, then user clicks Cancel on the card during the 'test' stage | `POST /api/deployments/:id/cancel`                                   | —                       | (turn keeps streaming)                         | Chat: DeploymentProgressCard shows cancelled; 'test' and later read skipped |
| C2-2 | System                                                                          | The deploy loop reads the cancel from its next stage write and stops | (same call, ends early) | final preliminary result, then the tool result | Workspace + card: deployment status `cancelled`, unreached stages `skipped` |

**Success criteria**

- No progress is streamed before the approval is granted.
- Cancel mid-run leaves a consistent `cancelled` deployment visible in both the card and the
  `get_deployment_history` result. (The success criterion originally named a Deploys tab in the
  workspace pane; that tab does not exist and no phase owns building it, so the check is against
  the stored deployment instead — which is what the e2e test asserts.)

> Cancel is an api route rather than the request's abort signal, and the turn is deliberately left
> running so the model can report what happened. A browser that stops reading a streamed response
> does not reliably abort the Worker's request, so the abort-signal design this scenario originally
> assumed would let the deploy run to completion while the card claimed it had stopped — see
> [ADR-0013](adr/0013-deployment-cancel-as-an-api-route.md).

**Eval assertions**

- The approval response strictly precedes the first progress part.
- In C2, the final deployment status is `cancelled` (not `failed`, not `succeeded`).

---

## S-D — Generative burndown chart from natural language

- **ID:** S-D
- **Goal:** a natural-language question produces a rich chart card, and the agent's narration is
  grounded in the chart's own data series.
- **First fully runnable phase:** Phase 7 (the data is available from Phase 3 via the fallback
  tool-chip JSON; the BurndownChart card lands in Phase 7).
- **Preconditions:** fresh seed at `WORKSPACE_NOW` (2026-07-01T09:00:00Z): Sprint 12 has 31
  committed points, 8 done — 13 points behind the ideal line (9.54 at the demo clock); DS-11 is
  blocked.

| Step | Actor | Action or prompt (verbatim)                    | Expected tool call                                          | Expected stream parts | Expected UI (workspace / chat)                                                                                                         |
| ---- | ----- | ---------------------------------------------- | ----------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | User  | "Is Sprint 12 on track? Show me the burndown." | —                                                           | —                     | Chat: user message                                                                                                                     |
| 2    | Agent | Fetches the burndown series                    | `get_burndown({ sprintId: 'sprint-12' })`                   | tool call + result    | Chat: BurndownChart card — remaining vs ideal lines over the sprint's 14 calendar days                                                 |
| 2b   | Agent | Reads the blockers the risk is named from      | `list_issues({ sprintId: 'sprint-12', status: 'blocked' })` | tool call + result    | Chat: IssueTable with DS-11. The series carries no issue data, so naming DS-11 without this read would be ungrounded                   |
| 3    | Agent | Narrates the chart                             | —                                                           | final text            | Chat: states the sprint is 13 points behind the ideal line (8/31 points done at 2026-07-01) and names DS-11 (blocked) as the main risk |

**Success criteria**

- The chart renders both series (remaining and ideal) for 14 calendar days.
- The narration matches the data (behind ideal, not "on track"), and calls out DS-11.

**Eval assertions**

- `get_burndown` is called exactly once (no redundant re-fetches).
- The final answer references values grounded in the returned series (committed 31, completed 8)
  and mentions DS-11.

---

## S-E — Error recovery

- **ID:** S-E
- **Goal:** a wrong issue key produces a typed tool error rendered in-stream, and the agent
  recovers by searching — not by blindly retrying or re-asking.
- **First fully runnable phase:** Phase 5.
- **Preconditions:** fresh seed; DS-42 does not exist (seed issues are DS-1..DS-13); DS-7 'Billing
  export CSV download' is in_review.

| Step | Actor | Action or prompt (verbatim)                                     | Expected tool call                                           | Expected stream parts    | Expected UI (workspace / chat)                                                                                                                                                                                                             |
| ---- | ----- | --------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | User  | "Mark DS-42 as done — the billing export shipped this morning." | —                                                            | —                        | Chat: user message                                                                                                                                                                                                                         |
| 2    | Agent | Requests the status change                                      | `update_issue_status({ issueKey: 'DS-42', status: 'done' })` | approval request part    | Chat: ApprovalCard                                                                                                                                                                                                                         |
| 3    | User  | Clicks Approve                                                  | (executes)                                                   | tool result (error)      | Chat: tool returns `{ ok: false, error: { code: 'ISSUE_NOT_FOUND' } }`; the ApprovalCard records "Approved by you at <time> — not applied." and the ErrorCard below it says "No issue DS-42 on the board." over the `ISSUE_NOT_FOUND` code |
| 4    | Agent | Recovers by searching, not retrying                             | `search_issues({ query: 'billing export' })`                 | tool call + result       | Chat: compact IssueTable of matches; top match DS-7 'Billing export CSV download' (in_review)                                                                                                                                              |
| 5    | Agent | Proposes the likely intended issue                              | —                                                            | text                     | Chat: one sentence on the failure, then the question: "Did you mean DS-7, “Billing export CSV download”?"                                                                                                                                  |
| 6    | User  | "Yes, that one."                                                | —                                                            | —                        | Chat: user message                                                                                                                                                                                                                         |
| 7    | Agent | Requests the corrected write                                    | `update_issue_status({ issueKey: 'DS-7', status: 'done' })`  | approval request part    | Chat: fresh ApprovalCard                                                                                                                                                                                                                   |
| 8    | User  | Clicks Approve                                                  | (executes)                                                   | tool result + final text | Workspace: DS-7 moves In Review → Done; chat: confirmation                                                                                                                                                                                 |

**Success criteria**

- The error is a typed envelope (`ISSUE_NOT_FOUND`) rendered as an ErrorCard, not a crash or a
  silent failure.
- The recovery write goes behind a fresh approval — the earlier approval of the failed call is
  never reused.

**Eval assertions**

- After the error, the agent's next tool call is `search_issues` (not a retry of DS-42, and not a
  bare re-ask with no tool use).
- The corrected `update_issue_status` for DS-7 executes only after a second, separate approval.
- Final workspace state: DS-7 is `done`; no issue DS-42 exists.

---

## S-F — External MCP host operates the same workspace

- **ID:** S-F
- **Goal:** prove the bidirectional MCP story — an external MCP host (Claude Desktop or Cursor)
  connects to the public issues MCP server and performs a write that is immediately visible in the
  DevSprint SPA. Same workspace, two clients.
- **First fully runnable phase:** Phase 6 locally; as written, with a public URL, since the Phase 14
  deploy. (Only `apps/mcp-issues` was built; the deploys and analytics servers were not.)
- **Preconditions:** Phase 6 deployed; the public issues MCP server URL (Streamable HTTP) is
  published in the README; fresh seed (highest existing issue key is DS-13); the DevSprint SPA is
  open in a browser alongside the external host. This scenario has no suggestion button — it is
  driven from the external host, and the SPA's empty transcript shows the endpoint to copy.

| Step | Actor                         | Action or prompt (verbatim)                                                                                                                   | Expected tool call                                                                                                  | Expected stream parts | Expected UI (workspace / chat)                                                                    |
| ---- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| 1    | Operator                      | Copies the public issues MCP server URL (Streamable HTTP) from the README and adds it to Claude Desktop (or Cursor) as a remote MCP server    | —                                                                                                                   | —                     | Host: server connected                                                                            |
| 2    | Host                          | Lists the server's tools                                                                                                                      | (MCP tools/list)                                                                                                    | —                     | Host: shows `list_issues`, `search_issues`, `create_issue`, `update_issue_status`, `assign_issue` |
| 3    | Operator                      | In the external host: "Create a DevSprint issue titled \"Add CSV export progress indicator\", type feature, medium priority, in the backlog." | —                                                                                                                   | —                     | Host: prompt sent                                                                                 |
| 4    | Host                          | Requests the write; shows its own tool-permission prompt (this replaces our ApprovalCard; server-side validation still applies)               | `create_issue({ title: 'Add CSV export progress indicator', type: 'feature', priority: 'medium', sprintId: null })` | — (host-native UI)    | Host: permission prompt → allow                                                                   |
| 5    | Server                        | Executes the validated write                                                                                                                  | (same call)                                                                                                         | —                     | Host: tool result with the new issue DS-14                                                        |
| 6    | Operator                      | Switches to the DevSprint SPA                                                                                                                 | —                                                                                                                   | —                     | Workspace: new backlog issue DS-14 visible on the board                                           |
| 7    | Operator (optional follow-up) | In the external host: "Move DS-14 to in progress."                                                                                            | `update_issue_status({ issueKey: 'DS-14', status: 'in_progress' })`                                                 | — (host-native UI)    | Host: permission prompt → allow; workspace: DS-14's backlog card reads In progress                |

**Success criteria**

- The external host can list and call the five issue tools without any DevSprint-specific client
  code.
- The write performed in the external host is visible in the SPA's workspace pane (same
  workspace, two clients).

**Eval assertions**

- The MCP server exposes exactly `list_issues`, `search_issues`, `create_issue`,
  `update_issue_status`, `assign_issue`.
- `create_issue` produces DS-14 with `sprintId: null` (backlog) and the exact title above.
- Server-side input validation runs even though the approval UX belongs to the host.

---

## Coverage matrix

Every one of the 10 original tools in [tool-inventory.md](./tool-inventory.md) appears in at least
one scenario. Tool 11, `assign_issue`, was added after the scenarios and appears in none; S-F's host
can list and call it, and its own end-to-end test assigns DS-12 to Dana
(`apps/web/e2e/chat.spec.ts`).

### Tools × scenarios

| Tool                   | S-A | S-B | S-C | S-D | S-E | S-F |
| ---------------------- | --- | --- | --- | --- | --- | --- |
| list_issues            | x   | x   |     | x   |     |     |
| search_issues          |     |     |     |     | x   |     |
| get_sprint_status      | x   |     |     |     |     |     |
| get_deployment_history |     |     | x   |     |     |     |
| get_burndown           |     |     |     | x   |     |     |
| diff_release_notes     | x   |     |     |     |     |     |
| create_issue           |     |     |     |     |     | x   |
| update_issue_status    |     | x   |     |     | x   | x   |
| create_release_notes   | x   |     |     |     |     |     |
| run_deployment         |     |     | x   |     |     |     |
| assign_issue           |     |     |     |     |     |     |

Note: in S-F, `list_issues`, `search_issues` and `assign_issue` are also exposed to the external
host (step 2) but are not required by the script; `update_issue_status` is exercised by the optional
follow-up (step 7).

### UI components × scenarios

| Component              | S-A | S-B | S-C | S-D | S-E | S-F                          |
| ---------------------- | --- | --- | --- | --- | --- | ---------------------------- |
| IssueTable             | x   | x   |     | x   | x   |                              |
| BurndownChart          |     |     |     | x   |     |                              |
| ReleaseNotesDiff       | x   |     |     |     |     |                              |
| DeploymentProgressCard |     |     | x   |     |     |                              |
| ApprovalCard           | x   | x   | x   |     | x   | (host-native prompt instead) |
| ErrorCard              |     |     |     |     | x   |                              |

S-F exercises no in-stream SPA cards — approval happens in the external host's own permission
prompt — but the SPA's workspace board is the observed surface (DS-14 appears in the backlog and,
with the optional follow-up, still in the backlog with its status reading In progress — a backlog
issue has no sprint, so it never enters the sprint's five columns).
