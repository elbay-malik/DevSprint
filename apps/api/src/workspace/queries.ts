/**
 * Pure query functions behind the six Phase 3 read tools. Each takes the
 * workspace snapshot plus the parsed tool input and returns the shared
 * `ToolResult` envelope — domain failures are `ok: false`, never thrown, so
 * the model can read the code and recover (docs/domain-model.md §4, S-E).
 * Derivation rules follow docs/domain-model.md; the clock is `workspace.now`.
 */
import {
  ISSUE_STATUSES,
  type Issue,
  type IssueStatus,
  type ReleaseNote,
  type Sprint,
  type ToolErrorCode,
  type ToolResult,
  type Workspace,
} from '@devsprint/shared'
import type {
  BurndownData,
  ChangedSection,
  DeploymentHistoryData,
  DeploymentSummary,
  DiffReleaseNotesInput,
  GetBurndownInput,
  GetDeploymentHistoryInput,
  GetSprintStatusInput,
  IssueSummary,
  ListIssuesData,
  ListIssuesInput,
  ReleaseNotesDiffData,
  SearchIssuesData,
  SearchIssuesInput,
  SearchIssuesMatch,
  SprintStatusData,
} from '@devsprint/shared/tools'
import { daysBetween, eachUtcDay, utcDateOf } from './dates'

function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data }
}

function fail(code: ToolErrorCode, message: string): ToolResult<never> {
  return { ok: false, error: { code, message } }
}

const round2 = (value: number): number => Math.round(value * 100) / 100

/** Numeric part of a `DS-<n>` key, for stable ascending ordering. */
function keyNumber(key: string): number {
  return Number.parseInt(key.slice(key.lastIndexOf('-') + 1), 10)
}

const byKeyNumber = (a: { key: string }, b: { key: string }): number =>
  keyNumber(a.key) - keyNumber(b.key)

/** `sprintId` undefined selects the active sprint. */
function findSprint(workspace: Workspace, sprintId: string | undefined): Sprint | undefined {
  return sprintId === undefined
    ? workspace.sprints.find((sprint) => sprint.state === 'active')
    : workspace.sprints.find((sprint) => sprint.id === sprintId)
}

function sprintNotFound(workspace: Workspace, sprintId: string | undefined): ToolResult<never> {
  const known = workspace.sprints.map((sprint) => sprint.id).join(', ')
  return fail(
    'SPRINT_NOT_FOUND',
    sprintId === undefined
      ? `There is no active sprint. Known sprints: ${known}.`
      : `No sprint with id '${sprintId}'. Known sprints: ${known}.`,
  )
}

function issuesOf(workspace: Workspace, sprint: Sprint): Issue[] {
  return workspace.issues.filter((issue) => issue.sprintId === sprint.id)
}

function sumPoints(issues: Issue[]): number {
  return issues.reduce((sum, issue) => sum + issue.points, 0)
}

function isCompletedBy(issue: Issue, iso: string): boolean {
  return issue.completedAt !== null && Date.parse(issue.completedAt) <= Date.parse(iso)
}

function toIssueSummary(issue: Issue): IssueSummary {
  return {
    key: issue.key,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    points: issue.points,
    assigneeId: issue.assigneeId,
    sprintId: issue.sprintId,
    labels: issue.labels,
  }
}

// --- 1. list_issues -----------------------------------------------------------

/**
 * Filtered issue list. Note: `sprintId` is a string in the contract, so the
 * backlog (`sprintId: null`) cannot be selected here — by design, not omission.
 */
export function listIssues(
  workspace: Workspace,
  input: ListIssuesInput,
): ToolResult<ListIssuesData> {
  if (input.sprintId !== undefined && !findSprint(workspace, input.sprintId)) {
    return sprintNotFound(workspace, input.sprintId)
  }
  if (
    input.assigneeId !== undefined &&
    !workspace.users.some((user) => user.id === input.assigneeId)
  ) {
    const known = workspace.users.map((user) => user.id).join(', ')
    return fail('USER_NOT_FOUND', `No user with id '${input.assigneeId}'. Known users: ${known}.`)
  }
  const issues = workspace.issues
    .filter(
      (issue) =>
        (input.sprintId === undefined || issue.sprintId === input.sprintId) &&
        (input.status === undefined || issue.status === input.status) &&
        (input.assigneeId === undefined || issue.assigneeId === input.assigneeId) &&
        (input.type === undefined || issue.type === input.type) &&
        (input.label === undefined || issue.labels.includes(input.label)),
    )
    .sort(byKeyNumber)
    .slice(0, input.limit)
    .map(toIssueSummary)
  return ok({ issues })
}

// --- 2. search_issues ---------------------------------------------------------

/** Lowercase alphanumeric tokens; everything else is a separator. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
}

/** `DS-7`, `ds-7` and `ds7` all compact to `ds7`. */
function compactKey(text: string): string {
  return tokenize(text).join('')
}

/**
 * Function words carry no search signal, but the weight-1 description field is
 * broad enough that one of them scores. Left in, `'what is DS-10'` ranks an
 * unrelated issue whose description happens to contain "is".
 */
const STOPWORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'did',
  'do',
  'does',
  'for',
  'from',
  'has',
  'have',
  'how',
  'i',
  'in',
  'is',
  'issue',
  'issues',
  'it',
  'its',
  'many',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'their',
  'there',
  'this',
  'to',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'you',
  'your',
])

/** Issue keys named anywhere in a phrase: `'close DS-7 and ds 10'` -> `['ds7', 'ds10']`. */
function namedKeys(query: string): string[] {
  return [...query.toLowerCase().matchAll(/([a-z]+)[^a-z0-9]{0,2}(\d+)/g)].map(
    (match) => `${match[1]}${match[2]}`,
  )
}

const SEARCH_FIELDS: ReadonlyArray<{ weight: number; tokens: (issue: Issue) => string[] }> = [
  { weight: 3, tokens: (issue) => tokenize(issue.title) },
  // The key is one token ('ds7'), otherwise the shared 'ds' prefix would match every issue.
  { weight: 3, tokens: (issue) => [compactKey(issue.key)] },
  { weight: 2, tokens: (issue) => issue.labels.flatMap(tokenize) },
  { weight: 1, tokens: (issue) => tokenize(issue.description) },
]
const TOTAL_SEARCH_WEIGHT = SEARCH_FIELDS.reduce((sum, field) => sum + field.weight, 0)

/** Weighted token-hit ratio across the search fields, normalized to [0, 1]. */
function relevance(issue: Issue, queryTokens: string[]): number {
  const weighted = SEARCH_FIELDS.reduce((sum, field) => {
    const haystack = new Set(field.tokens(issue))
    const hits = queryTokens.filter((token) => haystack.has(token)).length
    return sum + field.weight * (hits / queryTokens.length)
  }, 0)
  return round2(weighted / TOTAL_SEARCH_WEIGHT)
}

function toMatch(issue: Issue, score: number): SearchIssuesMatch {
  return { key: issue.key, title: issue.title, status: issue.status, score }
}

/** Fuzzy text search. Never errors — no matches is `ok: true` with `matches: []`. */
export function searchIssues(
  workspace: Workspace,
  input: SearchIssuesInput,
): ToolResult<SearchIssuesData> {
  if (tokenize(input.query).length === 0) return ok({ matches: [] })

  // Naming a key is an unambiguous request for that issue, whether the key is
  // the whole query ('DS-7') or sits inside a sentence ('close DS-7 please').
  const keys = namedKeys(input.query)
  const named = workspace.issues.filter((issue) => keys.includes(compactKey(issue.key)))
  if (named.length > 0) {
    return ok({ matches: named.toSorted(byKeyNumber).map((issue) => toMatch(issue, 1)) })
  }

  // A key that names nothing real ('DS-42') must not drag in noise matches —
  // scenario S-E recovers from an honest empty result, not a confident wrong one.
  const queryTokens = [...new Set(tokenize(input.query).filter((token) => !STOPWORDS.has(token)))]
  if (queryTokens.length === 0) return ok({ matches: [] })

  const matches = workspace.issues
    .map((issue) => toMatch(issue, relevance(issue, queryTokens)))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || byKeyNumber(a, b))
    .slice(0, input.limit)
  return ok({ matches })
}

// --- 3. get_sprint_status -----------------------------------------------------

export function getSprintStatus(
  workspace: Workspace,
  input: GetSprintStatusInput,
): ToolResult<SprintStatusData> {
  const sprint = findSprint(workspace, input.sprintId)
  if (!sprint) return sprintNotFound(workspace, input.sprintId)

  const issues = issuesOf(workspace, sprint)
  const committedPoints = sumPoints(issues)
  const completedPoints = sumPoints(issues.filter((issue) => isCompletedBy(issue, workspace.now)))
  const issueCountsByStatus = Object.fromEntries(
    ISSUE_STATUSES.map((status) => [status, 0]),
  ) as Record<IssueStatus, number>
  for (const issue of issues) issueCountsByStatus[issue.status] += 1

  return ok({
    sprint,
    stats: {
      committedPoints,
      completedPoints,
      remainingPoints: committedPoints - completedPoints,
      daysRemaining: Math.max(0, daysBetween(utcDateOf(workspace.now), sprint.endDate)),
      issueCountsByStatus,
      blockedIssueKeys: issues
        .filter((issue) => issue.status === 'blocked')
        .sort(byKeyNumber)
        .map((issue) => issue.key),
    },
  })
}

// --- 4. get_deployment_history ------------------------------------------------

/** Most recent first. Never errors — an empty history is a successful call. */
export function getDeploymentHistory(
  workspace: Workspace,
  input: GetDeploymentHistoryInput,
): ToolResult<DeploymentHistoryData> {
  const deployments: DeploymentSummary[] = workspace.deployments
    .filter(
      (deployment) =>
        input.environment === undefined || deployment.environment === input.environment,
    )
    .toSorted((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, input.limit)
    .map((deployment) => ({
      id: deployment.id,
      environment: deployment.environment,
      version: deployment.version,
      status: deployment.status,
      startedAt: deployment.startedAt,
      finishedAt: deployment.finishedAt,
      triggeredById: deployment.triggeredById,
    }))
  return ok({ deployments })
}

// --- 5. get_burndown ----------------------------------------------------------

/**
 * One bucket per UTC calendar day from `startDate` to `endDate` inclusive.
 * `remaining` applies the domain-model rule literally for every bucket (an
 * issue counts once the UTC date of its `completedAt` is <= the bucket), so the
 * line is flat after `now`. `ideal` is linear from committed to 0.
 */
export function getBurndown(
  workspace: Workspace,
  input: GetBurndownInput,
): ToolResult<BurndownData> {
  const sprint = findSprint(workspace, input.sprintId)
  if (!sprint) return sprintNotFound(workspace, input.sprintId)

  const issues = issuesOf(workspace, sprint)
  const committedPoints = sumPoints(issues)
  const completionDates = issues.flatMap((issue) =>
    issue.completedAt === null
      ? []
      : [{ date: utcDateOf(issue.completedAt), points: issue.points }],
  )
  const dates = eachUtcDay(sprint.startDate, sprint.endDate)
  const lastIndex = dates.length - 1
  const days = dates.map((date, index) => ({
    date,
    remaining:
      committedPoints -
      completionDates
        .filter((completion) => completion.date <= date)
        .reduce((sum, completion) => sum + completion.points, 0),
    // A one-day sprint has no slope to interpolate; it is simply burned down by its only day.
    ideal: lastIndex === 0 ? 0 : round2(committedPoints * (1 - index / lastIndex)),
  }))

  return ok({ sprintId: sprint.id, unit: 'points', committedPoints, asOf: workspace.now, days })
}

// --- 6. diff_release_notes ----------------------------------------------------

const HEADING_LINE = /^#{1,6}\s+(.*)$/
const FENCE_LINE = /^\s{0,3}(```|~~~)/

/**
 * Heading text → trimmed body, in document order. Text before the first
 * heading has no key and is ignored; a repeated heading keeps its last body.
 */
function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>()
  let heading: string | undefined
  let body: string[] = []
  const flush = (): void => {
    if (heading !== undefined) sections.set(heading, body.join('\n').trim())
  }
  let inFence = false
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE_LINE.test(line)) inFence = !inFence
    // A shell comment inside a fence ('# run the migration') is not a heading:
    // treating it as one invents a section and truncates the real one's body.
    const headingText = inFence ? undefined : HEADING_LINE.exec(line)?.[1]
    if (headingText === undefined) {
      body.push(line)
      continue
    }
    flush()
    heading = headingText.trim()
    body = []
  }
  flush()
  return sections
}

function latestPublished(workspace: Workspace): ReleaseNote | undefined {
  return workspace.releaseNotes
    .filter((note) => note.status === 'published')
    .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
}

/** Pure section-level comparison; never persists anything (saving is `create_release_notes`). */
export function diffReleaseNotes(
  workspace: Workspace,
  input: DiffReleaseNotesInput,
): ToolResult<ReleaseNotesDiffData> {
  const base =
    input.baseVersion === undefined
      ? latestPublished(workspace)
      : workspace.releaseNotes.find((note) => note.version === input.baseVersion)
  if (!base) {
    return fail(
      'INVALID_INPUT',
      input.baseVersion === undefined
        ? 'There are no published release notes to compare against.'
        : `No release notes exist for version '${input.baseVersion}'.`,
    )
  }

  const before = splitSections(base.markdown)
  const after = splitSections(input.draftMarkdown)
  const changedSections: ChangedSection[] = []
  for (const [heading, body] of before) {
    const draftBody = after.get(heading)
    if (draftBody === undefined) changedSections.push({ heading, changeType: 'removed' })
    else if (draftBody !== body) changedSections.push({ heading, changeType: 'modified' })
  }
  for (const heading of after.keys()) {
    if (!before.has(heading)) changedSections.push({ heading, changeType: 'added' })
  }

  return ok({
    baseVersion: base.version,
    before: base.markdown,
    after: input.draftMarkdown,
    changedSections,
  })
}
