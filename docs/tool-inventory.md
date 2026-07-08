# Tool Inventory

The DevSprint Copilot agent exposes exactly **10 tools**. Types (`Issue`, `Sprint`, `Deployment`,
…), the fixed demo clock `WORKSPACE_NOW`, and the shared result envelope are defined in
[domain-model.md](./domain-model.md). Every scripted demo in
[demo-scenarios.md](./demo-scenarios.md) exercises tools from this list and nothing else. The
approval policy below is the contract implemented in Phase 5 and recorded in
[ADR-0003](./adr/0003-hitl-approval-gates-on-write-tools.md).

All tools return the shared envelope from domain-model.md:

```ts
type ToolResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
```

## 1. Summary table

| #   | Tool                     | Risk class         | Approval policy                                             | In-stream UI component                | Future MCP server (Phase 6) |
| --- | ------------------------ | ------------------ | ----------------------------------------------------------- | ------------------------------------- | --------------------------- |
| 1   | `list_issues`            | read/query         | auto (never gated)                                          | IssueTable                            | issues (public)             |
| 2   | `search_issues`          | read/query         | auto                                                        | IssueTable (compact)                  | issues (public)             |
| 3   | `get_sprint_status`      | read/query         | auto                                                        | text + stat chips                     | analytics (optional)        |
| 4   | `get_deployment_history` | read/query         | auto                                                        | deployment list                       | deploys                     |
| 5   | `get_burndown`           | rich-data          | auto                                                        | BurndownChart                         | analytics (optional)        |
| 6   | `diff_release_notes`     | rich-data          | auto                                                        | ReleaseNotesDiff                      | deploys                     |
| 7   | `create_issue`           | gated write        | always requires approval                                    | ApprovalCard → confirmation           | issues (public)             |
| 8   | `update_issue_status`    | gated write        | always requires approval, one approval PER issue (no batch) | ApprovalCard → confirmation           | issues (public)             |
| 9   | `create_release_notes`   | gated write        | always requires approval                                    | ApprovalCard → confirmation           | deploys                     |
| 10  | `run_deployment`         | long-running write | always requires approval before start; cancellable mid-run  | ApprovalCard → DeploymentProgressCard | deploys                     |

The "Future MCP server" column maps to the Phase 6 packages `apps/mcp-issues`, `apps/mcp-deploys`,
and `apps/mcp-analytics` (reserved — not scaffolded in this pass). Until Phase 6, all 10 tools are
plain AI SDK function-calling tools inside `apps/api` (see
[ADR-0002](./adr/0002-staged-mcp-adoption.md)).

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
    days: { date: string; remaining: number; ideal: number }[],
} }
```

The `days` series is shaped for direct consumption by the BurndownChart (Unovis) component;
derivation rules for `remaining` and `ideal` live in domain-model.md.

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

**Behavior:** long-running simulated job. After approval, it streams progress events

```ts
{
  stage: StageName
  status: StageStatus
  progressPct: number
  logLine: string
}
```

as AI SDK data parts consumed by the DeploymentProgressCard (stages `build → test → migrate →
release`). Supports cancellation via `abortSignal`; a cancelled run finishes with deployment status
`'cancelled'`. There is no separate cancel tool — see section 4.

**Final output**

```ts
{ ok: true, data: { deployment: Deployment } }
```

**Errors:** `DEPLOY_IN_PROGRESS`, `VERSION_EXISTS` (version already live in that environment),
`STAGE_FAILED`

## 3. Approval policy

The policy is deliberately simple so it can be stated in one line: **reads and rich-data tools
always auto-execute; ALL writes are gated — no exceptions.**

1. **Which tools are gated.** Tools 1–6 (read/query and rich-data) never require approval. Tools
   7–10 (gated and long-running writes) always require explicit human approval before executing.
   There is no allowlist, no "trusted after first approval" mode, and no threshold logic.
2. **One approval per mutation.** Approvals are granted per tool call, never per conversation or
   per batch. For `update_issue_status` this means one approval per issue: a request implying N
   status changes produces N separate calls and N separate ApprovalCards (see scenario S-B).
3. **Mechanism (AI SDK v6).** Gating is enforced via AI SDK v6 tool approval — the current API is
   the `toolApproval` map on the ToolLoopAgent, with statuses `'not-applicable'`, `'approved'`,
   `'denied'`, and `'user-approval'`. The older per-tool `needsApproval` flag is **deprecated**;
   do not use it in new code. The client renders an ApprovalCard when the approval-request part
   arrives in the stream and responds via `addToolApprovalResponse`.
4. **Mandatory server-side re-validation.** Before executing an approved call, the server MUST
   re-validate the tool input against its schema and re-evaluate the approval policy. The message
   history that carries the approval response is client-controlled and cannot be trusted: a
   forged or replayed "approved" message must never be sufficient to execute a write. The policy
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

| Deferred tool           | Why deferred                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `assign_issue`          | Fold into a future general `update_issue` tool rather than adding a single-field write now.                       |
| `list_users`            | The 4-user roster is small and static; it is embedded in the Phase 3 system prompt instead (see domain-model.md). |
| `publish_release_notes` | Drafting covers the demo scenarios; publishing adds a second gated write with little new signal.                  |
| `cancel_deployment`     | Cancellation is handled via stream abort (`abortSignal` on `run_deployment`), not a tool call.                    |

If a later phase needs one of these, promote it here first and update
[demo-scenarios.md](./demo-scenarios.md), [wireframes.md](./wireframes.md), and the affected ADRs
in the same change.
