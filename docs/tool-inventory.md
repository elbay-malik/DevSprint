# Tool Inventory

The DevSprint Copilot agent exposes exactly **10 tools**. Types (`Issue`, `Sprint`, `Deployment`,
…), the fixed demo clock `WORKSPACE_NOW`, and the shared result envelope are defined in
[domain-model.md](./domain-model.md). Every scripted demo in
[demo-scenarios.md](./demo-scenarios.md) exercises tools from this list and nothing else. Phase 3
registers tools 1–6 (read/query and rich-data) as plain AI SDK function-calling tools in
`apps/api`; Phase 5 adds the three gated writes, tools 7–9. Tool 10, `run_deployment`, lands with
its simulation in Phase 8 and is gated like the other writes. The approval policy below is the contract
implemented in Phase 5, recorded in
[ADR-0003](./adr/0003-hitl-approval-gates-on-write-tools.md) (policy) and
[ADR-0010](./adr/0010-tool-approval-mechanism-and-replay-protection.md) (mechanism).

All tools return the shared envelope from domain-model.md:

```ts
type ToolResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
```

## 1. Summary table

| #   | Tool                     | Risk class         | Approval policy                                             | In-stream UI component                | Future MCP server (Phase 6) |
| --- | ------------------------ | ------------------ | ----------------------------------------------------------- | ------------------------------------- | --------------------------- |
| 1   | `list_issues`            | read/query         | auto (never gated)                                          | IssueTable                            | issues (public)             |
| 2   | `search_issues`          | read/query         | auto                                                        | IssueTable (compact)                  | issues (public)             |
| 3   | `get_sprint_status`      | read/query         | auto                                                        | ToolCallChip + text                   | analytics (optional)        |
| 4   | `get_deployment_history` | read/query         | auto                                                        | ToolCallChip + text                   | deploys                     |
| 5   | `get_burndown`           | rich-data          | auto                                                        | BurndownChart                         | analytics (optional)        |
| 6   | `diff_release_notes`     | rich-data          | auto                                                        | ReleaseNotesDiff                      | deploys                     |
| 7   | `create_issue`           | gated write        | always requires approval                                    | ApprovalCard → confirmation           | issues (public)             |
| 8   | `update_issue_status`    | gated write        | always requires approval, one approval PER issue (no batch) | ApprovalCard → confirmation           | issues (public)             |
| 9   | `create_release_notes`   | gated write        | always requires approval                                    | ApprovalCard → confirmation           | deploys                     |
| 10  | `run_deployment`         | long-running write | always requires approval before start; cancellable mid-run  | ApprovalCard → DeploymentProgressCard | deploys                     |

The "MCP server" column maps to the Phase 6 packages. `apps/mcp-issues` is built and public: the
four issue tools are served from it over Streamable HTTP, and the in-app agent sources those same
four through an MCP client, so both clients drive one implementation. `apps/mcp-deploys` and
`apps/mcp-analytics` are still reserved names, so the other six tools remain plain AI SDK
function-calling tools inside `apps/api` (see [ADR-0002](./adr/0002-staged-mcp-adoption.md)).

Tools 3 and 4 keep the ToolCallChip rather than earning a card — that is the component registry's
deliberate choice (docs/wireframes.md §5), not a gap.

## 2. Per-tool details

Tool descriptions are written as **trigger conditions** (when the model should reach for the tool),
not mechanisms. The quoted description below each tool name becomes the tool's `description` field
verbatim in Phase 3.

### 1. `list_issues`

> Use when the user asks what issues exist or wants a filtered view of issues by sprint, status,
> assignee, type, or label.

**Input**

```ts
z.object({
  sprintId: z.string().optional(),
  status: IssueStatus.optional(), // 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done'
  assigneeId: z.string().optional(),
  type: IssueType.optional(),
  label: z.string().optional(),
  limit: z.number().int().positive().default(50),
})
```

**Output**

```ts
{ ok: true, data: { issues: Pick<Issue,
    'key' | 'title' | 'status' | 'priority' | 'points' | 'assigneeId' | 'sprintId' | 'labels'>[] } }
```

**Errors:** `SPRINT_NOT_FOUND`, `USER_NOT_FOUND`

### 2. `search_issues`

> Use when the user refers to an issue by words, topic, or a partial/uncertain key and you need to
> find matching issues by fuzzy text.

**Input**

```ts
z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().default(10),
})
```

**Output**

```ts
{ ok: true, data: { matches: { key: string; title: string; status: IssueStatus; score: number }[] } }
```

No matches is not an error: the tool returns `ok: true` with `matches: []`. Scenario S-E relies on
this tool for recovery after an `ISSUE_NOT_FOUND` error.

**Errors:** none (empty result is a successful call)

### 3. `get_sprint_status`

> Use when the user asks how a sprint is going, its health, capacity, blockers, or what remains.

**Input**

```ts
z.object({
  sprintId: z.string().optional(), // default: the active sprint
})
```

**Output**

```ts
{ ok: true, data: {
    sprint: Sprint,
    stats: {
      committedPoints: number,
      completedPoints: number,
      remainingPoints: number,
      daysRemaining: number, // computed against WORKSPACE_NOW, never Date.now()
      issueCountsByStatus: Record<IssueStatus, number>,
      blockedIssueKeys: string[],
    },
} }
```

**Errors:** `SPRINT_NOT_FOUND`

### 4. `get_deployment_history`

> Use when the user asks what was deployed, when, to which environment, or whether a past deploy
> succeeded or failed.

**Input**

```ts
z.object({
  environment: Environment.optional(), // 'staging' | 'production'
  limit: z.number().int().positive().default(5),
})
```

**Output**

```ts
{ ok: true, data: { deployments: Pick<Deployment,
    'id' | 'environment' | 'version' | 'status' | 'startedAt' | 'finishedAt' | 'triggeredById'>[] } }
```

**Errors:** none (an empty history is a successful call)

### 5. `get_burndown`

> Use when the user asks whether a sprint is on track, asks about trend/velocity, or requests a
> burndown or progress chart.

**Input**

```ts
z.object({
  sprintId: z.string().optional(), // default: the active sprint
})
```

**Output**

```ts
{ ok: true, data: {
    sprintId: string,
    unit: 'points',
    committedPoints: number,
    asOf: string, // WORKSPACE_NOW the series was computed against
    days: { date: string; remaining: number; ideal: number }[],
} }
```

The `days` series is shaped for direct consumption by the BurndownChart component, which Phase 7
draws as inline SVG rather than with Unovis ([ADR-0012](./adr/0012-burndown-chart-as-inline-svg.md));
derivation rules for `remaining` and `ideal` live in domain-model.md. `asOf` is an additive Phase 3
field: the Phase 7 chart uses it to draw the "today" marker without touching `Date.now()`.

**Errors:** `SPRINT_NOT_FOUND`

### 6. `diff_release_notes`

> Use when the user wants to compare draft release notes against the last published version before
> saving or publishing.

**Input**

```ts
z.object({
  draftMarkdown: z.string().min(1),
  baseVersion: z.string().optional(), // default: latest published release note
})
```

**Output**

```ts
{ ok: true, data: {
    baseVersion: string,
    before: string,
    after: string,
    changedSections: { heading: string; changeType: 'added' | 'removed' | 'modified' }[],
} }
```

Shaped for the ReleaseNotesDiff card. This is a pure comparison — it never persists anything;
saving a draft is `create_release_notes`.

**Errors:** `INVALID_INPUT` (e.g. unknown `baseVersion`)

### 7. `create_issue` — gated write

> Use when the user asks to add, file, or log a new issue, bug, task, or spike in the workspace.

**Input**

```ts
z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: IssueType, // 'feature' | 'bug' | 'chore' | 'spike'
  priority: Priority.default('medium'),
  sprintId: z.string().nullable().default(null), // null = backlog
  assigneeId: z.string().optional(),
  points: z.number().int().positive().optional(),
  labels: z.array(z.string()).optional(),
})
```

**Output**

```ts
{ ok: true, data: { issue: Issue } } // server assigns the next DS-<n> key
```

**Errors:** `SPRINT_NOT_FOUND`, `USER_NOT_FOUND`, `INVALID_INPUT`

### 8. `update_issue_status` — gated write

> Use when the user asks to move, close, block, unblock, or reopen an existing issue (any status
> change).

**Input**

```ts
z.object({
  issueKey: z.string(), // human key, e.g. 'DS-7'
  status: IssueStatus,
  comment: z.string().optional(),
})
```

**Output**

```ts
{ ok: true, data: { issue: Issue, previousStatus: IssueStatus } }
```

**Errors:** `ISSUE_NOT_FOUND`, `INVALID_INPUT`

**Policy note:** when a request implies N status changes, the agent must issue N separate calls →
N separate approval cards. There is no batch variant, by design — scenario S-B ("close out Sprint
12") produces exactly 5 approval gates, one per open issue.

### 9. `create_release_notes` — gated write

> Use when the user asks to draft or save release notes for a version. The agent composes the
> markdown itself (from done issues) and passes it in.

**Input**

```ts
z.object({
  version: z.string(), // e.g. 'v1.5.0'
  markdown: z.string().min(1),
  sprintId: z.string().optional(),
})
```

**Output**

```ts
{ ok: true, data: { releaseNote: ReleaseNote } } // status is always 'draft'
```

**Errors:** `VERSION_EXISTS`, `INVALID_INPUT`

Publishing is a deferred future tool (see section 4) — this tool only ever saves drafts.

### 10. `run_deployment` — long-running write

> Use when the user asks to deploy, ship, release, or roll out a version to an environment.

**Input**

```ts
z.object({
  environment: Environment, // 'staging' | 'production'
  version: z.string(),
  skipTests: z.boolean().default(false), // only on explicit user request
})
```

**Behavior:** long-running simulated job, about eleven seconds over stages
`build → test → migrate → release`. After approval it reports progress by being an async generator:
each yield is a complete `ToolResult<{ deployment: Deployment }>`, which the SDK streams to the
client as a preliminary tool result. DeploymentProgressCard therefore redraws from the same shape it
will eventually settle on, rather than from a separate event type — which is why this tool has no
progress-event payload of its own. Every stage is persisted as it happens, so a run that ends early
is still recorded where it got to.

Cancellation is a `POST /api/deployments/:id/cancel` route, not the request's abort signal, and not
a tool — see section 4 and [ADR-0013](./adr/0013-deployment-cancel-as-an-api-route.md). A cancelled
run finishes with deployment status `'cancelled'` and its unreached stages marked `'skipped'`.

**Final output**

```ts
{ ok: true, data: { deployment: Deployment } }
```

**Errors:** `DEPLOY_IN_PROGRESS`, `VERSION_EXISTS` (version already live in that environment),
`INVALID_INPUT`. The simulation has no failure path, so `STAGE_FAILED` is reserved rather than
raised; `DEPLOY_ALREADY_SETTLED` belongs to the cancel route rather than the tool.

## 3. Approval policy

The policy is deliberately simple so it can be stated in one line: **reads and rich-data tools
always auto-execute; ALL writes are gated — no exceptions.**

1. **Which tools are gated.** Tools 1–6 (read/query and rich-data) never require approval. Tools
   7–10 (gated and long-running writes) always require explicit human approval before executing.
   There is no allowlist, no "trusted after first approval" mode, and no threshold logic.
2. **One approval per mutation.** Approvals are granted per tool call, never per conversation or
   per batch. For `update_issue_status` this means one approval per issue: a request implying N
   status changes produces N separate calls and N separate ApprovalCards (see scenario S-B).
3. **Mechanism (AI SDK v6, corrected in Phase 5).** Gating is `needsApproval: true` on the tool.
   There is no `toolApproval` map in `ai@6.0.277` and `needsApproval` is not deprecated — this
   paragraph previously said the opposite, which was verified wrong against the installed package
   (see [ADR-0010](./adr/0010-tool-approval-mechanism-and-replay-protection.md)). A gated call
   emits an approval-request part instead of executing; the client renders an ApprovalCard and
   responds via `addToolApprovalResponse({ id, approved, reason })`, where `id` is the approval id.
   All approvals raised in one step arrive together, so N gated calls produce N cards at once and
   the turn resumes when the last one is answered.
4. **Mandatory server-side re-validation.** Before executing an approved call, the server MUST
   re-validate the tool input against its schema and re-evaluate the approval policy. The message
   history that carries the approval response is client-controlled and cannot be trusted: a
   forged or replayed "approved" message must never be sufficient to execute a write. Forgery is
   covered by signing each approval request (`experimental_toolApprovalSecret`); replay is **not**
   covered by the SDK and needs the server's own one-time-use ledger. The policy
   vs. mechanism split (policy is stable; the SDK API has churned) is recorded in
   [ADR-0003](./adr/0003-hitl-approval-gates-on-write-tools.md).
5. **Denials.** A denied call never mutates state. The denial (with optional reason) is returned
   to the model, which must acknowledge it in its final answer rather than silently retrying.
6. **External MCP hosts.** When the same write tools are exposed over MCP in Phase 6 (scenario
   S-F), approval UX is delegated to the host's own tool-permission prompt (Claude Desktop,
   Cursor, …) — our ApprovalCard is not in that loop. Server-side input validation and policy
   evaluation still apply unchanged.

## 4. Considered and deferred

Kept within the 6–10 tool budget. Each of these was considered and deliberately left out:

| Deferred tool           | Why deferred                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assign_issue`          | Fold into a future general `update_issue` tool rather than adding a single-field write now.                                                                                                                                                                                                                                        |
| `list_users`            | The 4-user roster is small and static; it is embedded in the Phase 3 system prompt instead (see domain-model.md).                                                                                                                                                                                                                  |
| `publish_release_notes` | Drafting covers the demo scenarios; publishing adds a second gated write with little new signal.                                                                                                                                                                                                                                   |
| `cancel_deployment`     | Cancel comes from a button, so it is an api route (`POST /api/deployments/:id/cancel`), not a tool call. Routing it through the model would make whether the deploy stops depend on the model choosing to call it, and it could not be reached mid-tool-call at all — [ADR-0013](./adr/0013-deployment-cancel-as-an-api-route.md). |

If a later phase needs one of these, promote it here first and update
[demo-scenarios.md](./demo-scenarios.md), [wireframes.md](./wireframes.md), and the affected ADRs
in the same change.
