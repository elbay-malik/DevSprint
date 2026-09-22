# Domain model

This document is the **single source of truth** for the mock DevSprint workspace: the Phase 1 seed
fixtures in `packages/shared` (`@devsprint/shared`) and the Phase 3 tool implementations in
`apps/api` (`@devsprint/api`) must be generated from it verbatim — same ids, keys, dates, and
points. If a value here changes, the fixtures, the tool inventory
([tool-inventory.md](./tool-inventory.md)), and the demo scenarios
([demo-scenarios.md](./demo-scenarios.md)) must change together.

## 1. Conventions

- All timestamps are ISO-8601 UTC strings (e.g. `2026-06-25T16:00:00Z`). Sprint `startDate` /
  `endDate` are date-only ISO strings (`YYYY-MM-DD`) interpreted as UTC calendar days — they bound
  the burndown's day buckets.
- Ids are kebab-case: `u-alice`, `sprint-12`, `dep-3`. Issue ids are the lowercased human key
  (`ds-1` for `DS-1`).
- Issues are referenced by their human key `DS-<n>` in chat, tool inputs, and scenario scripts —
  never by internal id.
- **Fixed demo clock:** the workspace has no real "now". Fixtures export

  ```ts
  export const WORKSPACE_NOW = '2026-07-01T09:00:00Z'
  ```

  and every time-dependent computation (`get_sprint_status`, `get_burndown`, "days remaining",
  overdue checks) uses it. Tools must **never** call `Date.now()` — that is what keeps the demo
  deterministic and the scripted scenarios in [demo-scenarios.md](./demo-scenarios.md) replayable.

## 2. Types

Copy-pasteable TypeScript sketches. These are transcribed into `packages/shared` as the canonical
types.

```ts
type IssueStatus = 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done'
type IssueType = 'feature' | 'bug' | 'chore' | 'spike'
type Priority = 'low' | 'medium' | 'high' | 'urgent'
type SprintState = 'planned' | 'active' | 'completed'
type Environment = 'staging' | 'production'
type DeploymentStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
type StageName = 'build' | 'test' | 'migrate' | 'release'
type StageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'

interface User {
  id: string
  name: string
  handle: string
  role: 'tech_lead' | 'engineer' | 'devops' | 'product'
  avatarColor: string
}
interface Project {
  id: string
  key: string
  name: string
  description: string
}
interface Sprint {
  id: string
  projectId: string
  name: string
  goal: string
  state: SprintState
  startDate: string
  endDate: string
}
interface Issue {
  id: string
  key: string
  projectId: string
  sprintId: string | null
  title: string
  description: string
  type: IssueType
  status: IssueStatus
  priority: Priority
  assigneeId: string | null
  reporterId: string
  points: number
  labels: string[]
  blockedReason: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}
interface DeploymentStage {
  name: StageName
  status: StageStatus
  startedAt: string | null
  finishedAt: string | null
  logTail: string[]
}
interface Deployment {
  id: string
  projectId: string
  environment: Environment
  version: string
  status: DeploymentStatus
  stages: DeploymentStage[]
  triggeredById: string
  commitSha: string
  startedAt: string
  finishedAt: string | null
}
interface ReleaseNote {
  id: string
  projectId: string
  version: string
  sprintId: string | null
  status: 'draft' | 'published'
  markdown: string
  authorId: string
  createdAt: string
  updatedAt: string
}
interface Workspace {
  now: string
  project: Project
  users: User[]
  sprints: Sprint[]
  issues: Issue[]
  deployments: Deployment[]
  releaseNotes: ReleaseNote[]
}
```

The five `IssueStatus` values are exactly the five columns of the issue board (todo / in_progress /
in_review / blocked / done). `Workspace.now` is `WORKSPACE_NOW`.

### Derivation rules (documented, not stored)

These values are computed by tools, never persisted on entities:

- Sprint `committedPoints` = sum of `points` of issues with that `sprintId`.
- Sprint `completedPoints` = sum of `points` of issues where `completedAt != null` and
  `completedAt <= now`.
- Burndown `remaining(d)` = `committedPoints` minus points of issues completed on or before day
  `d`.
- Burndown `ideal(d)` = linear interpolation from `committedPoints` down to 0 across the sprint's
  calendar days.
  - Day buckets are UTC calendar days from `startDate` to `endDate` inclusive (14 for sprint-12:
    2026-06-22 … 2026-07-05). `remaining` is computed literally for every bucket — an issue counts
    once the UTC date of its `completedAt` is `<= d` — so the line is flat after `now`. With `n`
    buckets indexed `i = 0 … n−1`, `ideal(i) = committedPoints × (1 − i/(n−1))`, rounded to
    2 decimals (`ideal(0) = committedPoints`, `ideal(n−1) = 0`). The series carries `asOf = now`
    so a chart can place the "today" marker.
- Sprint `daysRemaining` = calendar days between the UTC date of `now` and `endDate` (4 for
  sprint-12 at `WORKSPACE_NOW`; 0 for the completed sprint-11), never negative.
- `triggeredById` (Deployment), `authorId` (ReleaseNote) and `reporterId` (Issue) may be a user id
  **or** the literal string `'agent'` when the copilot performed the action.
- An issue the copilot files with no estimate gets `points: 0`, so an unestimated issue cannot
  inflate a sprint's committed total or distort the burndown.

## 3. Seed data

Exact values. The fixtures in `packages/shared` are this section, transcribed.

### Project

| Field       | Value                                                        |
| ----------- | ------------------------------------------------------------ |
| id          | proj-1                                                       |
| key         | DS                                                           |
| name        | DevSprint                                                    |
| description | Delivery workspace for the fictional Nimbus web product team |

### Users

| Id      | Name         | Handle | Role      | avatarColor |
| ------- | ------------ | ------ | --------- | ----------- |
| u-alice | Alice Chen   | @alice | tech_lead | #7c3aed     |
| u-ben   | Ben Osei     | @ben   | engineer  | #0ea5e9     |
| u-chidi | Chidi Okafor | @chidi | engineer  | #10b981     |
| u-dana  | Dana Petrova | @dana  | devops    | #f59e0b     |

### Sprints

| Id        | Name                                | Goal                                                 | State     | Start      | End        |
| --------- | ----------------------------------- | ---------------------------------------------------- | --------- | ---------- | ---------- |
| sprint-11 | Sprint 11 — Search & auth hardening | Stabilize search relevance and close auth edge cases | completed | 2026-06-08 | 2026-06-19 |
| sprint-12 | Sprint 12 — Notifications & billing | Ship notification digests and billing export         | active    | 2026-06-22 | 2026-07-05 |

### Issues (13)

> **The count is intentional.** The original planning brief said "~12 issues"; the seed (and
> [product-brief.md](./product-brief.md)) has **13** so that
> scenario S-B ("close every remaining open Sprint 12 issue") yields **exactly 5** approval gates —
> the five open sprint-12 issues DS-7, DS-8, DS-9, DS-10, DS-11. Do not "fix" the count back to 12;
> that silently breaks S-B.

`reporterId` for **all** issues: `u-alice`. `blockedReason` is `null` unless stated. Issue
`description` values are one to two sentences of flavor text authored in the fixtures; they are not
load-bearing for any scenario, except that DS-7's title/description must plausibly match the fuzzy
query "billing export" (scenario S-E).

Sprint 11 — all done:

| Key  | Title                                  | Type    | Priority | Assignee | Pts | Labels         |
| ---- | -------------------------------------- | ------- | -------- | -------- | --- | -------------- |
| DS-1 | Fix OAuth token refresh loop           | bug     | high     | u-chidi  | 3   | auth           |
| DS-2 | Search results ranking ignores recency | bug     | medium   | u-ben    | 5   | search         |
| DS-3 | Add rate limiting to login endpoint    | feature | high     | u-chidi  | 3   | auth, security |
| DS-4 | Upgrade session store to KV v2         | chore   | low      | u-dana   | 2   | infra          |

Sprint 12 — 31 committed points:

| Key   | Title                              | Type    | Priority | Assignee | Pts | Status      | Labels              |
| ----- | ---------------------------------- | ------- | -------- | -------- | --- | ----------- | ------------------- |
| DS-5  | Notification digest email template | feature | medium   | u-ben    | 3   | done        | notifications       |
| DS-6  | Digest scheduling worker (cron)    | feature | high     | u-chidi  | 5   | done        | notifications       |
| DS-7  | Billing export CSV download        | feature | high     | u-ben    | 5   | in_review   | billing             |
| DS-8  | Unsubscribe link 404s on staging   | bug     | urgent   | u-chidi  | 2   | in_review   | notifications       |
| DS-9  | Notification preferences page      | feature | medium   | u-ben    | 5   | in_progress | notifications       |
| DS-10 | Invoice PDF rendering service      | feature | high     | u-chidi  | 8   | in_progress | billing             |
| DS-11 | Load-test digest fan-out           | chore   | medium   | u-dana   | 3   | blocked     | notifications, perf |

- DS-11 `blockedReason`: `'Waiting on vendor sandbox account'`.

Backlog — `sprintId: null`, status `todo`, `assigneeId: null`:

| Key   | Title                    | Type    | Priority | Pts | Labels  |
| ----- | ------------------------ | ------- | -------- | --- | ------- |
| DS-12 | Dark mode theme audit    | chore   | low      | 3   | ui      |
| DS-13 | Self-serve plan upgrades | feature | medium   | 8   | billing |

Timestamps (`updatedAt` = `completedAt` for done issues; `—` = null):

| Key   | createdAt            | updatedAt            | completedAt          |
| ----- | -------------------- | -------------------- | -------------------- |
| DS-1  | 2026-06-05T09:00:00Z | 2026-06-12T16:00:00Z | 2026-06-12T16:00:00Z |
| DS-2  | 2026-06-05T09:00:00Z | 2026-06-16T16:00:00Z | 2026-06-16T16:00:00Z |
| DS-3  | 2026-06-05T09:00:00Z | 2026-06-17T16:00:00Z | 2026-06-17T16:00:00Z |
| DS-4  | 2026-06-05T09:00:00Z | 2026-06-18T16:00:00Z | 2026-06-18T16:00:00Z |
| DS-5  | 2026-06-19T09:00:00Z | 2026-06-25T16:00:00Z | 2026-06-25T16:00:00Z |
| DS-6  | 2026-06-19T09:00:00Z | 2026-06-29T16:00:00Z | 2026-06-29T16:00:00Z |
| DS-7  | 2026-06-19T09:00:00Z | 2026-06-30T11:00:00Z | —                    |
| DS-8  | 2026-06-26T09:00:00Z | 2026-06-30T14:00:00Z | —                    |
| DS-9  | 2026-06-19T09:00:00Z | 2026-06-29T10:00:00Z | —                    |
| DS-10 | 2026-06-19T09:00:00Z | 2026-06-27T15:00:00Z | —                    |
| DS-11 | 2026-06-19T09:00:00Z | 2026-06-26T13:00:00Z | —                    |
| DS-12 | 2026-06-02T09:00:00Z | 2026-06-02T09:00:00Z | —                    |
| DS-13 | 2026-06-15T09:00:00Z | 2026-06-15T09:00:00Z | —                    |

**Sprint 12 health at `WORKSPACE_NOW`:** 8 of 31 points done (DS-5 + DS-6), 23 remaining, 4
calendar days left. That puts the burndown line behind the ideal line — deliberately, so scenario
S-D ("Is Sprint 12 on track?") has a real narrative: slightly behind, with DS-11 blocked as the
named risk.

### Deployments (5)

`projectId` is `proj-1` for all. Versions map to commits: v1.4.0 → `f3a92c1`, v1.4.1 → `8b04d7e`,
v1.4.2 → `c19ae52` (fake 7-hex shas; a version deployed to both environments reuses its sha).

| Id    | Env        | Version | Status    | Triggered by | Sha     | startedAt            | finishedAt           |
| ----- | ---------- | ------- | --------- | ------------ | ------- | -------------------- | -------------------- |
| dep-1 | staging    | v1.4.0  | succeeded | u-dana       | f3a92c1 | 2026-06-10T14:02:00Z | 2026-06-10T14:13:00Z |
| dep-2 | production | v1.4.0  | succeeded | u-dana       | f3a92c1 | 2026-06-12T10:30:00Z | 2026-06-12T10:41:00Z |
| dep-3 | staging    | v1.4.1  | failed    | u-chidi      | 8b04d7e | 2026-06-17T15:20:00Z | 2026-06-17T15:26:00Z |
| dep-4 | staging    | v1.4.2  | succeeded | u-chidi      | c19ae52 | 2026-06-18T09:45:00Z | 2026-06-18T09:56:00Z |
| dep-5 | production | v1.4.2  | succeeded | u-dana       | c19ae52 | 2026-06-19T11:00:00Z | 2026-06-19T11:12:00Z |

Stages always run in order build → test → migrate → release. Succeeded deployments have all four
stages `succeeded`; each stage's `logTail` is 2–4 plausible lines authored in the fixtures
(non-normative). **dep-3 is the exception and is normative:** it failed at the `test` stage, so its
stages are build `succeeded`, test `failed`, migrate `skipped`, release `skipped`, and the test
stage's `logTail` must mention the billing export e2e flake:

```ts
// dep-3, stage 'test'
{
  name: 'test',
  status: 'failed',
  startedAt: '2026-06-17T15:22:10Z',
  finishedAt: '2026-06-17T15:26:00Z',
  logTail: [
    'RUN e2e suite: 42 specs',
    'FAIL billing-export.spec.ts — download link timed out (billing export e2e flake)',
    "Stage 'test' failed after 3m 50s",
  ],
}
```

### Release notes (1)

| Field     | Value                |
| --------- | -------------------- |
| id        | rn-1                 |
| projectId | proj-1               |
| version   | v1.4.2               |
| status    | published            |
| authorId  | u-alice              |
| createdAt | 2026-06-19T12:00:00Z |
| updatedAt | 2026-06-19T12:00:00Z |

`markdown` (verbatim — scenario S-A diffs a v1.5.0 draft against this text):

```markdown
## v1.4.2 — Sprint 11: Search & auth hardening

### Fixed

- OAuth token refresh no longer loops when a refresh token expires mid-session (DS-1)
- Search ranking now weights recency, so fresh results stop losing to stale exact matches (DS-2)

### Added

- Rate limiting on the login endpoint: 10 attempts per minute per IP with progressive backoff (DS-3)
- Session store upgraded to KV v2 for faster reads and TTL-based session cleanup (DS-4)
```

## 4. Tool result envelope

Every tool (Phase 3 onward) returns one shape, so the chat stream's `ErrorCard` has exactly one
thing to render:

```ts
type ToolResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: ToolErrorCode; message: string } }

type ToolErrorCode =
  | 'ISSUE_NOT_FOUND'
  | 'SPRINT_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'VERSION_EXISTS'
  | 'DEPLOY_IN_PROGRESS'
  | 'STAGE_FAILED'
  | 'INVALID_INPUT'
```

Canonical error codes:

| Code               | Meaning                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| ISSUE_NOT_FOUND    | No issue with the given key (e.g. `DS-42` in scenario S-E)             |
| SPRINT_NOT_FOUND   | No sprint with the given id                                            |
| USER_NOT_FOUND     | No user with the given id (bad `assigneeId` filter or assignment)      |
| VERSION_EXISTS     | Release notes for that version already exist, or version already live  |
| DEPLOY_IN_PROGRESS | A deployment is already running for that environment                   |
| STAGE_FAILED       | A deployment stage failed; the deployment ends `failed`                |
| INVALID_INPUT      | Input failed schema or domain validation (catch-all for bad arguments) |

Notes:

- An empty result set is **not** an error: `search_issues` with no matches returns
  `{ ok: true, data: { matches: [] } }`.
- Tools must not throw for domain failures — they return `ok: false` so the agent can see the code
  and recover (scenario S-E depends on this).

## 5. User roster and name resolution

The 4-user roster is small and static. It will be embedded verbatim in the Phase 3 system prompt so
the model can resolve names and handles to `assigneeId`s ("assign it to Dana" → `u-dana`) without a
`list_users` tool — see the "Considered and deferred" section of
[tool-inventory.md](./tool-inventory.md).
