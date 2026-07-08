/**
 * Deterministic seed data for the mock workspace.
 * Source of truth: docs/domain-model.md — transcribed verbatim; do not tweak
 * values here without updating the doc (and vice versa). The seed is tuned so
 * demo scenario S-B yields exactly 5 approval gates (5 open Sprint-12 issues)
 * and S-E can recover from DS-42 (absent) to DS-7.
 */
import type {
  Deployment,
  DeploymentStage,
  Issue,
  IssueStatus,
  IssueType,
  Priority,
  StageName,
  Workspace,
} from './types'

/** Fixed demo clock — tools must use this, never Date.now(). */
export const WORKSPACE_NOW = '2026-07-01T09:00:00Z'

interface IssueSeed {
  n: number
  sprintId: string | null
  title: string
  description: string
  type: IssueType
  status: IssueStatus
  priority: Priority
  assigneeId: string | null
  points: number
  labels: string[]
  blockedReason?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

function issue(seed: IssueSeed): Issue {
  return {
    id: `issue-${seed.n}`,
    key: `DS-${seed.n}`,
    projectId: 'proj-1',
    sprintId: seed.sprintId,
    title: seed.title,
    description: seed.description,
    type: seed.type,
    status: seed.status,
    priority: seed.priority,
    assigneeId: seed.assigneeId,
    reporterId: 'u-alice',
    points: seed.points,
    labels: seed.labels,
    blockedReason: seed.blockedReason ?? null,
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
    completedAt: seed.completedAt ?? null,
  }
}

function stage(
  name: StageName,
  status: DeploymentStage['status'],
  startedAt: string | null,
  finishedAt: string | null,
  logTail: string[] = [],
): DeploymentStage {
  return { name, status, startedAt, finishedAt, logTail }
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString().replace('.000Z', 'Z')
}

/** Succeeded deployment with all four stages spread across the start/finish window. */
function succeededDeployment(seed: {
  id: string
  environment: Deployment['environment']
  version: string
  triggeredById: string
  commitSha: string
  startedAt: string
  finishedAt: string
}): Deployment {
  const buildEnd = addMinutes(seed.startedAt, 3)
  const testEnd = addMinutes(seed.startedAt, 8)
  const migrateEnd = addMinutes(seed.startedAt, 9)
  return {
    id: seed.id,
    projectId: 'proj-1',
    environment: seed.environment,
    version: seed.version,
    status: 'succeeded',
    stages: [
      stage('build', 'succeeded', seed.startedAt, buildEnd, [
        `checked out ${seed.commitSha}`,
        'build completed with 0 warnings',
      ]),
      stage('test', 'succeeded', buildEnd, testEnd, [
        'RUN e2e suite: 42 specs',
        'all specs passed',
      ]),
      stage('migrate', 'succeeded', testEnd, migrateEnd, ['no pending migrations']),
      stage('release', 'succeeded', migrateEnd, seed.finishedAt, [
        `released ${seed.version} to ${seed.environment}`,
      ]),
    ],
    triggeredById: seed.triggeredById,
    commitSha: seed.commitSha,
    startedAt: seed.startedAt,
    finishedAt: seed.finishedAt,
  }
}

/** Returns a fresh, mutation-safe copy of the seed workspace. */
export function createWorkspaceSeed(): Workspace {
  return {
    now: WORKSPACE_NOW,
    project: {
      id: 'proj-1',
      key: 'DS',
      name: 'DevSprint',
      description: 'Delivery workspace for the fictional Nimbus web product team',
    },
    users: [
      {
        id: 'u-alice',
        name: 'Alice Chen',
        handle: 'alice',
        role: 'tech_lead',
        avatarColor: '#7c3aed',
      },
      { id: 'u-ben', name: 'Ben Osei', handle: 'ben', role: 'engineer', avatarColor: '#0ea5e9' },
      {
        id: 'u-chidi',
        name: 'Chidi Okafor',
        handle: 'chidi',
        role: 'engineer',
        avatarColor: '#10b981',
      },
      {
        id: 'u-dana',
        name: 'Dana Petrova',
        handle: 'dana',
        role: 'devops',
        avatarColor: '#f59e0b',
      },
    ],
    sprints: [
      {
        id: 'sprint-11',
        projectId: 'proj-1',
        name: 'Sprint 11 — Search & auth hardening',
        goal: 'Stabilize search relevance and close auth edge cases',
        state: 'completed',
        startDate: '2026-06-08',
        endDate: '2026-06-19',
      },
      {
        id: 'sprint-12',
        projectId: 'proj-1',
        name: 'Sprint 12 — Notifications & billing',
        goal: 'Ship notification digests and billing export',
        state: 'active',
        startDate: '2026-06-22',
        endDate: '2026-07-05',
      },
    ],
    issues: [
      // Sprint 11 — all done
      issue({
        n: 1,
        sprintId: 'sprint-11',
        title: 'Fix OAuth token refresh loop',
        description:
          'Refresh tokens are re-requested in a tight loop when a token expires mid-session.',
        type: 'bug',
        status: 'done',
        priority: 'high',
        assigneeId: 'u-chidi',
        points: 3,
        labels: ['auth'],
        createdAt: '2026-06-05T09:00:00Z',
        updatedAt: '2026-06-12T16:00:00Z',
        completedAt: '2026-06-12T16:00:00Z',
      }),
      issue({
        n: 2,
        sprintId: 'sprint-11',
        title: 'Search results ranking ignores recency',
        description:
          'Fresh results lose to stale exact matches because the recency boost is dropped.',
        type: 'bug',
        status: 'done',
        priority: 'medium',
        assigneeId: 'u-ben',
        points: 5,
        labels: ['search'],
        createdAt: '2026-06-05T09:00:00Z',
        updatedAt: '2026-06-16T16:00:00Z',
        completedAt: '2026-06-16T16:00:00Z',
      }),
      issue({
        n: 3,
        sprintId: 'sprint-11',
        title: 'Add rate limiting to login endpoint',
        description:
          'Login endpoint accepts unlimited attempts; add per-IP throttling with backoff.',
        type: 'feature',
        status: 'done',
        priority: 'high',
        assigneeId: 'u-chidi',
        points: 3,
        labels: ['auth', 'security'],
        createdAt: '2026-06-05T09:00:00Z',
        updatedAt: '2026-06-17T16:00:00Z',
        completedAt: '2026-06-17T16:00:00Z',
      }),
      issue({
        n: 4,
        sprintId: 'sprint-11',
        title: 'Upgrade session store to KV v2',
        description: 'Migrate session persistence to the KV v2 API before v1 sunset.',
        type: 'chore',
        status: 'done',
        priority: 'low',
        assigneeId: 'u-dana',
        points: 2,
        labels: ['infra'],
        createdAt: '2026-06-05T09:00:00Z',
        updatedAt: '2026-06-18T16:00:00Z',
        completedAt: '2026-06-18T16:00:00Z',
      }),
      // Sprint 12 — 31 committed points, 8 done at WORKSPACE_NOW
      issue({
        n: 5,
        sprintId: 'sprint-12',
        title: 'Notification digest email template',
        description: 'Responsive email template for the daily notification digest.',
        type: 'feature',
        status: 'done',
        priority: 'medium',
        assigneeId: 'u-ben',
        points: 3,
        labels: ['notifications'],
        createdAt: '2026-06-19T09:00:00Z',
        updatedAt: '2026-06-25T16:00:00Z',
        completedAt: '2026-06-25T16:00:00Z',
      }),
      issue({
        n: 6,
        sprintId: 'sprint-12',
        title: 'Digest scheduling worker (cron)',
        description: 'Cron-triggered worker that fans out digest jobs per timezone cohort.',
        type: 'feature',
        status: 'done',
        priority: 'high',
        assigneeId: 'u-chidi',
        points: 5,
        labels: ['notifications'],
        createdAt: '2026-06-19T09:00:00Z',
        updatedAt: '2026-06-29T16:00:00Z',
        completedAt: '2026-06-29T16:00:00Z',
      }),
      issue({
        n: 7,
        sprintId: 'sprint-12',
        title: 'Billing export CSV download',
        description:
          'Customers can run a billing export of their invoices for a date range as CSV.',
        type: 'feature',
        status: 'in_review',
        priority: 'high',
        assigneeId: 'u-ben',
        points: 5,
        labels: ['billing'],
        createdAt: '2026-06-19T09:00:00Z',
        updatedAt: '2026-06-30T11:00:00Z',
      }),
      issue({
        n: 8,
        sprintId: 'sprint-12',
        title: 'Unsubscribe link 404s on staging',
        description: 'Digest unsubscribe URL misses the locale prefix on staging.',
        type: 'bug',
        status: 'in_review',
        priority: 'urgent',
        assigneeId: 'u-chidi',
        points: 2,
        labels: ['notifications'],
        createdAt: '2026-06-26T09:00:00Z',
        updatedAt: '2026-06-30T14:00:00Z',
      }),
      issue({
        n: 9,
        sprintId: 'sprint-12',
        title: 'Notification preferences page',
        description: 'Per-channel opt-in/opt-out settings page.',
        type: 'feature',
        status: 'in_progress',
        priority: 'medium',
        assigneeId: 'u-ben',
        points: 5,
        labels: ['notifications'],
        createdAt: '2026-06-19T09:00:00Z',
        updatedAt: '2026-06-29T10:00:00Z',
      }),
      issue({
        n: 10,
        sprintId: 'sprint-12',
        title: 'Invoice PDF rendering service',
        description: 'Server-side PDF rendering for invoices with brand templates.',
        type: 'feature',
        status: 'in_progress',
        priority: 'high',
        assigneeId: 'u-chidi',
        points: 8,
        labels: ['billing'],
        createdAt: '2026-06-19T09:00:00Z',
        updatedAt: '2026-06-27T15:00:00Z',
      }),
      issue({
        n: 11,
        sprintId: 'sprint-12',
        title: 'Load-test digest fan-out',
        description: 'Verify the digest fan-out sustains 50k recipients within the send window.',
        type: 'chore',
        status: 'blocked',
        priority: 'medium',
        assigneeId: 'u-dana',
        points: 3,
        labels: ['notifications', 'perf'],
        blockedReason: 'Waiting on vendor sandbox account',
        createdAt: '2026-06-19T09:00:00Z',
        updatedAt: '2026-06-26T13:00:00Z',
      }),
      // Backlog
      issue({
        n: 12,
        sprintId: null,
        title: 'Dark mode theme audit',
        description: 'Audit all views for dark-mode contrast regressions.',
        type: 'chore',
        status: 'todo',
        priority: 'low',
        assigneeId: null,
        points: 3,
        labels: ['ui'],
        createdAt: '2026-06-02T09:00:00Z',
        updatedAt: '2026-06-02T09:00:00Z',
      }),
      issue({
        n: 13,
        sprintId: null,
        title: 'Self-serve plan upgrades',
        description: 'Let customers upgrade plans without contacting support.',
        type: 'feature',
        status: 'todo',
        priority: 'medium',
        assigneeId: null,
        points: 8,
        labels: ['billing'],
        createdAt: '2026-06-15T09:00:00Z',
        updatedAt: '2026-06-15T09:00:00Z',
      }),
    ],
    deployments: [
      succeededDeployment({
        id: 'dep-1',
        environment: 'staging',
        version: 'v1.4.0',
        triggeredById: 'u-dana',
        commitSha: 'f3a92c1',
        startedAt: '2026-06-10T14:02:00Z',
        finishedAt: '2026-06-10T14:13:00Z',
      }),
      succeededDeployment({
        id: 'dep-2',
        environment: 'production',
        version: 'v1.4.0',
        triggeredById: 'u-dana',
        commitSha: 'f3a92c1',
        startedAt: '2026-06-12T10:30:00Z',
        finishedAt: '2026-06-12T10:41:00Z',
      }),
      {
        id: 'dep-3',
        projectId: 'proj-1',
        environment: 'staging',
        version: 'v1.4.1',
        status: 'failed',
        stages: [
          stage('build', 'succeeded', '2026-06-17T15:20:00Z', '2026-06-17T15:22:10Z', [
            'checked out 8b04d7e',
            'build completed with 0 warnings',
          ]),
          // Normative per docs/domain-model.md — scenario data for deploy history
          stage('test', 'failed', '2026-06-17T15:22:10Z', '2026-06-17T15:26:00Z', [
            'RUN e2e suite: 42 specs',
            'FAIL billing-export.spec.ts — download link timed out (billing export e2e flake)',
            "Stage 'test' failed after 3m 50s",
          ]),
          stage('migrate', 'skipped', null, null),
          stage('release', 'skipped', null, null),
        ],
        triggeredById: 'u-chidi',
        commitSha: '8b04d7e',
        startedAt: '2026-06-17T15:20:00Z',
        finishedAt: '2026-06-17T15:26:00Z',
      },
      succeededDeployment({
        id: 'dep-4',
        environment: 'staging',
        version: 'v1.4.2',
        triggeredById: 'u-chidi',
        commitSha: 'c19ae52',
        startedAt: '2026-06-18T09:45:00Z',
        finishedAt: '2026-06-18T09:56:00Z',
      }),
      succeededDeployment({
        id: 'dep-5',
        environment: 'production',
        version: 'v1.4.2',
        triggeredById: 'u-dana',
        commitSha: 'c19ae52',
        startedAt: '2026-06-19T11:00:00Z',
        finishedAt: '2026-06-19T11:12:00Z',
      }),
    ],
    releaseNotes: [
      {
        id: 'rn-1',
        projectId: 'proj-1',
        version: 'v1.4.2',
        status: 'published',
        // Verbatim from docs/domain-model.md — scenario S-A diffs a v1.5.0 draft against this
        markdown: [
          '## v1.4.2 — Sprint 11: Search & auth hardening',
          '',
          '### Fixed',
          '',
          '- OAuth token refresh no longer loops when a refresh token expires mid-session (DS-1)',
          '- Search ranking now weights recency, so fresh results stop losing to stale exact matches (DS-2)',
          '',
          '### Added',
          '',
          '- Rate limiting on the login endpoint: 10 attempts per minute per IP with progressive backoff (DS-3)',
          '- Session store upgraded to KV v2 for faster reads and TTL-based session cleanup (DS-4)',
        ].join('\n'),
        authorId: 'u-alice',
        createdAt: '2026-06-19T12:00:00Z',
        updatedAt: '2026-06-19T12:00:00Z',
      },
    ],
  }
}
