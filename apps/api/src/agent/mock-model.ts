/**
 * Scripted stand-in for a real model: keyless local dev, CI and e2e runs
 * without spending Groq/Gemini quota. It speaks the LanguageModelV3 streaming
 * protocol, so `streamText` drives it exactly like a provider. On a user turn
 * it picks ONE tool by keyword (restricted to the tools the caller registered);
 * on a tool turn it streams a short summary grounded in the tool output.
 */
import { simulateReadableStream } from 'ai'
import { ISSUE_STATUSES, type IssueStatus, type ToolResult } from '@devsprint/shared'
import type {
  BurndownData,
  CreateIssueData,
  CreateReleaseNotesData,
  DeploymentHistoryData,
  ListIssuesData,
  ReleaseNotesDiffData,
  RunDeploymentData,
  SearchIssuesData,
  SprintStatusData,
  UpdateIssueStatusData,
} from '@devsprint/shared/tools'
import { utcDateOf } from '../workspace/dates'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from './provider-types'

export interface MockToolCall {
  toolName: string
  input: Record<string, unknown>
}

export type MockDecision = ({ kind: 'tool-call' } & MockToolCall) | { kind: 'text'; text: string }

/** `1 issue` / `2 issues` — the summaries are read by a person. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Splits text into whitespace-preserving tokens for a word-by-word stream. */
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? []
}

// --- keyword router (user turn) ------------------------------------------------

const STATUS_WORDS: ReadonlyArray<[RegExp, IssueStatus]> = [
  [/\bdone\b/i, 'done'],
  [/\bblocked\b/i, 'blocked'],
  [/\bin review\b/i, 'in_review'],
  [/\bin progress\b/i, 'in_progress'],
  [/\bto ?do\b/i, 'todo'],
]

function statusFrom(text: string): IssueStatus | undefined {
  return STATUS_WORDS.find(([pattern]) => pattern.test(text))?.[1]
}

/** `DS-7` named anywhere in the sentence, normalised to upper case. */
function issueKeyFrom(text: string): string | undefined {
  return /\bds-\d+\b/i.exec(text)?.[0]?.toUpperCase()
}

/**
 * "Sprint 12" → `{ sprintId: 'sprint-12' }`, and nothing when no sprint is
 * named, so "the current sprint" still means the tool's own default.
 */
function sprintInputFrom(text: string): { sprintId?: string } {
  const number = /\bsprint[ -]?(\d+)\b/i.exec(text)?.[1]
  return number === undefined ? {} : { sprintId: `sprint-${number}` }
}

/** `v1.5.0`, `v1.5.0-rc.1` — the version the user named, if they named one. */

function versionFrom(text: string): string | undefined {
  return /\bv\d+\.\d+\.\d+(?:-[\w.]+)?/i.exec(text)?.[0]
}

function environmentFrom(text: string): 'staging' | 'production' | undefined {
  if (/\bprod(uction)?\b/i.test(text)) return 'production'
  if (/\bstaging\b/i.test(text)) return 'staging'
  return undefined
}

/** "find billing export" → "billing export"; falls back to the whole text. */
function searchQueryFrom(text: string): string {
  const stripped = text
    .replace(/\b(find|search(?: for)?|look up)\b/gi, '')
    .replace(/[?.!]+\s*$/, '')
    .trim()
  return stripped.length > 0 ? stripped : text
}

/** Longest chain the mock will script, matching the demo scenarios (S-A uses three). */
const MAX_PLAN_LENGTH = 3

const DRAFT_NEEDED =
  'To compare release notes I need the draft markdown — paste the draft and I will diff it against the last published version.'

/**
 * Every tool the question calls for, in the order a person would gather them.
 * A compound question ("summarize the sprint and draft release notes") yields
 * several entries, which is what drives the multi-step loop; a plain question
 * yields one. Rule order matters: "show me the burndown" must reach
 * get_burndown before the broader list rule.
 */
export function planUserText(text: string, availableTools: ReadonlySet<string>): MockDecision[] {
  // Comparing release notes is the one request the mock knows it cannot serve:
  // diff_release_notes needs draft markdown the user has not given. Say so,
  // rather than quietly summarising the sprint and never mentioning the diff.
  // Checked up front because "release notes" also matches the chain rule below.
  if (/diff|compare/i.test(text) && /release note|changelog/i.test(text)) {
    return [{ kind: 'text', text: DRAFT_NEEDED }]
  }

  const candidates: MockDecision[] = []

  // "Mark DS-42 as done" is a status change, even when the sentence goes on to
  // explain why ("— the billing export shipped this morning"). Checked before
  // the deploy rules because that explanation is exactly the kind of clause
  // whose "shipped" would otherwise route the whole turn to deployment
  // history, which is what kept scenario S-E from ever running.
  const namedKey = issueKeyFrom(text)
  const namedStatus = statusFrom(text)
  if (
    namedKey !== undefined &&
    namedStatus !== undefined &&
    /\b(mark|set|move|close|reopen|flag|put)\b/i.test(text)
  ) {
    return [
      {
        kind: 'tool-call',
        toolName: 'update_issue_status',
        input: { issueKey: namedKey, status: namedStatus },
      },
    ]
  }

  // "Deploy v1.5.0-rc.1 to staging" asks for the write; "has v1.4.2 shipped?"
  // asks for the history. A named version plus an instruction rather than a
  // question is what separates them.
  const version = versionFrom(text)
  const asksAboutThePast = /\b(has|have|had|did|was|were|what|when|which|already)\b/i.test(text)
  // "release notes" borrows the verb without meaning a deployment.
  const meansReleaseNotes = /release note|changelog/i.test(text)
  if (
    /\b(deploy|ship|release|roll ?out)\b/i.test(text) &&
    version !== undefined &&
    !asksAboutThePast &&
    !meansReleaseNotes
  ) {
    candidates.push({
      kind: 'tool-call',
      toolName: 'run_deployment',
      input: { environment: environmentFrom(text) ?? 'staging', version },
    })
  } else if (/deploy|shipped|rolled out/i.test(text)) {
    const environment = environmentFrom(text)
    candidates.push({
      kind: 'tool-call',
      toolName: 'get_deployment_history',
      input: environment === undefined ? {} : { environment },
    })
  }
  if (/burndown|on track|trend|velocity/i.test(text)) {
    candidates.push({ kind: 'tool-call', toolName: 'get_burndown', input: sprintInputFrom(text) })
  }
  // "On track?" wants the risk named, and the series carries no issue data, so
  // the blockers are a second read rather than a guess (S-D names DS-11).
  if (/on track/i.test(text)) {
    candidates.push({
      kind: 'tool-call',
      toolName: 'list_issues',
      input: { sprintId: sprintInputFrom(text).sprintId ?? 'sprint-12', status: 'blocked' },
    })
  }
  if (/find|search|look up/i.test(text)) {
    candidates.push({
      kind: 'tool-call',
      toolName: 'search_issues',
      input: { query: searchQueryFrom(text) },
    })
  }
  // Release notes are written from the sprint's completed work, so this is the
  // scripted chain: how the sprint went, then what actually shipped.
  if (/release note|changelog/i.test(text)) {
    candidates.push(
      { kind: 'tool-call', toolName: 'get_sprint_status', input: sprintInputFrom(text) },
      {
        kind: 'tool-call',
        toolName: 'list_issues',
        input: { sprintId: 'sprint-12', status: 'done' },
      },
    )
  }
  // Closing out a sprint starts by finding what is still open; the writes are
  // then derived from that result rather than guessed.
  if (/clos|wrap up|mark every|every remaining|all remaining|finish the sprint/i.test(text)) {
    candidates.push({
      kind: 'tool-call',
      toolName: 'list_issues',
      input: { sprintId: 'sprint-12' },
    })
  }
  if (/summar|how is|how are|health/i.test(text)) {
    candidates.push({
      kind: 'tool-call',
      toolName: 'get_sprint_status',
      input: sprintInputFrom(text),
    })
  }
  // "Show me the burndown" asks for the chart alone (S-D), so a bare "show"
  // only means a list when it is not about a chart in the same sentence.
  if (
    /list|show\b(?![^.?!]*\b(burndown|chart|trend|velocity)\b)|which issues|what issues|done issues|blocked issues|in review|in progress/i.test(
      text,
    )
  ) {
    const status = statusFrom(text)
    candidates.push({
      kind: 'tool-call',
      toolName: 'list_issues',
      input: status === undefined ? { sprintId: 'sprint-12' } : { sprintId: 'sprint-12', status },
    })
  }
  // A bare "compare" alongside a real intent must not hijack it, so this only
  // applies when nothing else matched (see the calls.length check below).
  if (/diff|compare/i.test(text)) {
    candidates.push({ kind: 'text', text: DRAFT_NEEDED })
  }

  const usable = candidates.filter(
    (candidate) => candidate.kind === 'text' || availableTools.has(candidate.toolName),
  )
  const calls = usable.filter((candidate) => candidate.kind === 'tool-call')

  // Text is a dead end — nothing follows it — so it is used only when no tool
  // matched at all. The one case where it should win outright is handled above.
  if (calls.length === 0) {
    const firstText = usable.find((candidate) => candidate.kind === 'text')
    if (firstText) return [firstText]
    return availableTools.has('get_sprint_status')
      ? [{ kind: 'tool-call', toolName: 'get_sprint_status', input: {} }]
      : [
          {
            kind: 'text',
            text: 'None of the tools I know how to use are registered in this session.',
          },
        ]
  }

  const seen = new Set<string>()
  return calls
    .filter((call) => {
      if (seen.has(call.toolName)) return false
      seen.add(call.toolName)
      return true
    })
    .slice(0, MAX_PLAN_LENGTH)
}

/** The plan's first step, for callers that only need one decision. */
export function routeUserText(text: string, availableTools: ReadonlySet<string>): MockDecision {
  return (
    planUserText(text, availableTools)[0] ?? {
      kind: 'text',
      text: 'None of the tools I know how to use are registered in this session.',
    }
  )
}

// --- grounded summaries (tool turn) -------------------------------------------

function isEnvelope(value: unknown): value is ToolResult<unknown> {
  return (
    typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean'
  )
}

function summarizeSprintStatus({ sprint, stats }: SprintStatusData): string {
  const open = ISSUE_STATUSES.filter((status) => status !== 'done').reduce(
    (sum, status) => sum + stats.issueCountsByStatus[status],
    0,
  )
  const blocked =
    stats.blockedIssueKeys.length > 0
      ? `Blocked: ${stats.blockedIssueKeys.join(', ')}.`
      : 'No blocked issues.'
  return `${sprint.name}: ${open} open issues, ${stats.remainingPoints} of ${stats.committedPoints} points remaining, ${stats.daysRemaining} days left. ${blocked}`
}

function summarizeIssues({ issues }: ListIssuesData): string {
  if (issues.length === 0) return 'No issues match that filter.'
  const items = issues.map(
    (issue) => `${issue.key} (${issue.status}, ${issue.points} pts) ${issue.title}`,
  )
  return `${plural(issues.length, 'issue')}: ${items.join('; ')}.`
}

function summarizeSearch({ matches }: SearchIssuesData): string {
  if (matches.length === 0) return 'No matching issues.'
  const items = matches.map(
    (match) => `${match.key} "${match.title}" (${match.status}, score ${match.score})`,
  )
  return `Best matches: ${items.join('; ')}.`
}

function summarizeDeployments({ deployments }: DeploymentHistoryData): string {
  if (deployments.length === 0) return 'No deployments recorded.'
  const items = deployments.map(
    (deployment) =>
      `${deployment.id} ${deployment.version} → ${deployment.environment} ${deployment.status} (${deployment.startedAt})`,
  )
  return `${plural(deployments.length, 'deployment')}, latest first: ${items.join('; ')}.`
}

function summarizeBurndown(data: BurndownData): string {
  const asOfDate = utcDateOf(data.asOf)
  const today = data.days.filter((day) => day.date <= asOfDate).at(-1) ?? data.days[0]
  if (!today) return `Burndown for ${data.sprintId}: the sprint has no days.`
  const verdict =
    today.remaining > today.ideal
      ? 'behind the ideal line'
      : today.remaining < today.ideal
        ? 'ahead of the ideal line'
        : 'on the ideal line'
  return `Burndown for ${data.sprintId} as of ${today.date}: ${data.committedPoints - today.remaining} of ${data.committedPoints} points done, ${today.remaining} remaining vs ${today.ideal} ideal — ${verdict}.`
}

function summarizeDiff(data: ReleaseNotesDiffData): string {
  if (data.changedSections.length === 0) {
    return `The draft matches ${data.baseVersion} section for section.`
  }
  const groups = (['added', 'modified', 'removed'] as const).flatMap((changeType) => {
    const headings = data.changedSections
      .filter((section) => section.changeType === changeType)
      .map((section) => `"${section.heading}"`)
    return headings.length === 0 ? [] : [`${changeType}: ${headings.join(', ')}`]
  })
  return `Compared with ${data.baseVersion} — ${groups.join('; ')}.`
}

function summarizeStatusChange(data: UpdateIssueStatusData): string {
  return `${data.issue.key} moved ${data.previousStatus} → ${data.issue.status}.`
}

function summarizeCreatedIssue(data: CreateIssueData): string {
  const where = data.issue.sprintId === null ? 'the backlog' : data.issue.sprintId
  return `Created ${data.issue.key} "${data.issue.title}" in ${where}.`
}

function summarizeCreatedReleaseNotes(data: CreateReleaseNotesData): string {
  return `Saved ${data.releaseNote.version} release notes as a ${data.releaseNote.status}.`
}

function summarizeDeployment(data: RunDeploymentData): string {
  const { deployment } = data
  const reached = deployment.stages
    .filter((stage) => stage.status === 'succeeded')
    .map((stage) => stage.name)
  const stages = reached.length > 0 ? ` Completed: ${reached.join(', ')}.` : ''
  return `${deployment.version} → ${deployment.environment}: ${deployment.status}.${stages}`
}

/** One grounded sentence per tool; the `ok: false` envelope is surfaced by code. */
export function summarizeToolOutput(toolName: string, output: unknown): string {
  if (!isEnvelope(output)) return `${toolName} returned an unexpected result.`
  if (!output.ok) return `${toolName} failed with ${output.error.code}: ${output.error.message}`
  // The mock only ever runs against our own tools, so the payload shape follows from the name.
  switch (toolName) {
    case 'get_sprint_status':
      return summarizeSprintStatus(output.data as SprintStatusData)
    case 'list_issues':
      return summarizeIssues(output.data as ListIssuesData)
    case 'search_issues':
      return summarizeSearch(output.data as SearchIssuesData)
    case 'get_deployment_history':
      return summarizeDeployments(output.data as DeploymentHistoryData)
    case 'get_burndown':
      return summarizeBurndown(output.data as BurndownData)
    case 'diff_release_notes':
      return summarizeDiff(output.data as ReleaseNotesDiffData)
    case 'update_issue_status':
      return summarizeStatusChange(output.data as UpdateIssueStatusData)
    case 'create_issue':
      return summarizeCreatedIssue(output.data as CreateIssueData)
    case 'create_release_notes':
      return summarizeCreatedReleaseNotes(output.data as CreateReleaseNotesData)
    case 'run_deployment':
      return summarizeDeployment(output.data as RunDeploymentData)
    default:
      return `${toolName} returned ${JSON.stringify(output.data)}.`
  }
}

// --- LanguageModelV3 plumbing ---------------------------------------------------

type ToolMessage = Extract<LanguageModelV3Message, { role: 'tool' }>
type ToolResultOutput = Extract<ToolMessage['content'][number], { type: 'tool-result' }>['output']

/** Tool results reach the model as `{ type: 'json' | 'text' | …, value }`. */
function unwrapOutput(output: ToolResultOutput): unknown {
  switch (output.type) {
    case 'json':
    case 'error-json':
      return output.value
    case 'text':
    case 'error-text':
      try {
        return JSON.parse(output.value)
      } catch {
        return output.value
      }
    default:
      return undefined
  }
}

/**
 * A denied call never runs, and the model has to say so rather than imply the
 * write happened — scenario S-B turns on the final answer admitting the denial.
 */
function summarizeToolResultPart(
  part: { toolName: string; toolCallId: string; output: ToolResultOutput },
  inputByToolCallId: ReadonlyMap<string, unknown>,
): string {
  if (part.output.type === 'execution-denied') {
    // A tool result carries no input, so the denial sentence has to name its
    // subject by looking back at the call the user turned down.
    const target = describeWriteTarget(part.toolName, inputByToolCallId.get(part.toolCallId))
    const reason = part.output.reason
    return reason === undefined
      ? `${target} was not approved, so nothing changed.`
      : `${target} was not approved (${reason}), so nothing changed.`
  }
  return summarizeToolOutput(part.toolName, unwrapOutput(part.output))
}

/** What a rejected write would have touched, for the denial sentence. */
function describeWriteTarget(toolName: string, input: unknown): string {
  if (typeof input === 'object' && input !== null) {
    if ('issueKey' in input && typeof input.issueKey === 'string') return input.issueKey
    if ('version' in input && typeof input.version === 'string') {
      return `release notes ${input.version}`
    }
    if ('title' in input && typeof input.title === 'string') return `"${input.title}"`
  }
  return toolName
}

function summarizeToolMessage(
  message: ToolMessage,
  inputByToolCallId: ReadonlyMap<string, unknown>,
): string {
  const summaries = message.content.flatMap((part) =>
    part.type === 'tool-result' ? [summarizeToolResultPart(part, inputByToolCallId)] : [],
  )
  return summaries.length > 0 ? summaries.join(' ') : 'The tool returned no result.'
}

/** Tool call id → the input the agent asked for, gathered from the transcript. */
function inputsByToolCallId(prompt: LanguageModelV3Prompt): Map<string, unknown> {
  const inputs = new Map<string, unknown>()
  for (const message of prompt) {
    if (message.role !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue
      inputs.set(
        part.toolCallId,
        typeof part.input === 'string' ? safeJson(part.input) : part.input,
      )
    }
  }
  return inputs
}

function userTextOf(message: LanguageModelV3Message | undefined): string {
  if (message?.role !== 'user') return ''
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function availableToolNames(options: LanguageModelV3CallOptions): ReadonlySet<string> {
  return new Set((options.tools ?? []).flatMap((t) => (t.type === 'function' ? [t.name] : [])))
}

/** All counters undefined: the mock has no tokens to report. */
const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
}

function finish(unified: 'stop' | 'tool-calls'): LanguageModelV3StreamPart {
  return { type: 'finish', finishReason: { unified, raw: undefined }, usage: EMPTY_USAGE }
}

function textChunks(text: string): LanguageModelV3StreamPart[] {
  const id = crypto.randomUUID()
  return [
    { type: 'text-start', id },
    ...tokenize(text).map((delta): LanguageModelV3StreamPart => ({
      type: 'text-delta',
      id,
      delta,
    })),
    { type: 'text-end', id },
    finish('stop'),
  ]
}

/**
 * Several calls may share one step. That is how a close-out request produces a
 * gate per issue: the model asks for every write at once and the SDK pauses on
 * all of them, one approval each.
 */
function toolCallChunks(calls: MockToolCall[]): LanguageModelV3StreamPart[] {
  return [
    ...calls.map((call): LanguageModelV3StreamPart => ({
      type: 'tool-call',
      toolCallId: crypto.randomUUID(),
      toolName: call.toolName,
      input: JSON.stringify(call.input),
    })),
    finish('tool-calls'),
  ]
}

/** Issue keys the agent has already asked to change this turn. */
function issueKeysAlreadyRequested(prompt: LanguageModelV3Prompt): Set<string> {
  const keys = new Set<string>()
  const lastUserIndex = prompt.findLastIndex((message) => message.role === 'user')
  for (const message of prompt.slice(lastUserIndex + 1)) {
    if (message.role !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool-call' || part.toolName !== 'update_issue_status') continue
      const input: unknown = typeof part.input === 'string' ? safeJson(part.input) : part.input
      if (typeof input === 'object' && input !== null && 'issueKey' in input) {
        const { issueKey } = input
        if (typeof issueKey === 'string') keys.add(issueKey)
      }
    }
  }
  return keys
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The `issues` array of a `list_issues` payload, defensively narrowed. */
function readIssueSummaries(data: unknown): Array<{ key: string; status: string; title: string }> {
  if (typeof data !== 'object' || data === null || !('issues' in data)) return []
  const { issues } = data
  if (!Array.isArray(issues)) return []
  return issues.flatMap((issue: unknown) =>
    typeof issue === 'object' &&
    issue !== null &&
    'key' in issue &&
    typeof issue.key === 'string' &&
    'status' in issue &&
    typeof issue.status === 'string'
      ? [
          {
            key: issue.key,
            status: issue.status,
            title: 'title' in issue && typeof issue.title === 'string' ? issue.title : '',
          },
        ]
      : [],
  )
}

/** Every issue a `list_issues` result returned this turn, done or not. */
function issuesFromResults(
  messages: ToolMessage[],
): Array<{ key: string; status: string; title: string }> {
  const found: Array<{ key: string; status: string; title: string }> = []
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolName !== 'list_issues') continue
      const output = unwrapOutput(part.output)
      if (!isEnvelope(output) || !output.ok) continue
      found.push(...readIssueSummaries(output.data))
    }
  }
  return found
}

/**
 * The draft the agent "writes" at step 4 of scenario S-A — composed from the
 * work the `list_issues` call actually returned, so the markdown names real
 * issues rather than hard-coded ones.
 */
function composeReleaseNotes(version: string, gathered: ToolMessage[]): string {
  const shipped = issuesFromResults(gathered).filter((issue) => issue.status === 'done')
  const lines = shipped.map((issue) => `- ${issue.title} (${issue.key})`)
  return [`## ${version} — Sprint 12`, '', '### Shipped', '', ...lines].join('\n')
}

/** Was this tool already called during the current turn? */
function alreadyCalled(gathered: ToolMessage[], toolName: string): boolean {
  return gathered.some((message) =>
    message.content.some((part) => part.type === 'tool-result' && part.toolName === toolName),
  )
}

/**
 * Scenario S-A, steps 4-5: once the reads are in, diff the composed draft
 * against the last published notes. It cannot be a static plan entry, because
 * the markdown is derived from the `list_issues` result rather than from the
 * user's sentence.
 *
 * `baseVersion` is left off deliberately — the tool defaults to the latest
 * published note, which is what the scenario means by "vs rn-1", and the mock
 * has no view of the workspace to name it from.
 */
function releaseNotesDiffCalls(
  text: string,
  gathered: ToolMessage[],
  availableTools: ReadonlySet<string>,
): MockToolCall[] {
  if (!availableTools.has('diff_release_notes')) return []
  if (!/release note|changelog/i.test(text)) return []
  const version = versionFrom(text)
  if (version === undefined) return []
  if (alreadyCalled(gathered, 'diff_release_notes')) return []
  if (!alreadyCalled(gathered, 'list_issues')) return []
  return [
    {
      toolName: 'diff_release_notes',
      input: { draftMarkdown: composeReleaseNotes(version, gathered) },
    },
  ]
}

/**
 * Scenario S-A, step 7: "Looks good, save it." The version and the markdown
 * come from the diff the previous turn already produced, so the saved note is
 * the draft the user actually approved rather than a fresh guess.
 */
function saveReleaseNotesCalls(
  text: string,
  prompt: LanguageModelV3Prompt,
  availableTools: ReadonlySet<string>,
): MockToolCall[] {
  if (!availableTools.has('create_release_notes')) return []
  if (!/\b(save|looks good|ship it|go ahead)\b/i.test(text)) return []

  // The draft was the input to diff_release_notes on an earlier turn.
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index]
    if (message?.role !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool-call' || part.toolName !== 'diff_release_notes') continue
      const input: unknown = typeof part.input === 'string' ? safeJson(part.input) : part.input
      if (typeof input !== 'object' || input === null || !('draftMarkdown' in input)) continue
      const { draftMarkdown } = input
      if (typeof draftMarkdown !== 'string') continue
      const version = versionFrom(draftMarkdown) ?? versionFrom(text)
      if (version === undefined) continue
      return [{ toolName: 'create_release_notes', input: { version, markdown: draftMarkdown } }]
    }
  }
  return []
}

/** Open issues named by a `list_issues` result already gathered this turn. */
function openIssueKeysFromResults(messages: ToolMessage[]): string[] {
  const keys: string[] = []
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolName !== 'list_issues') continue
      const output = unwrapOutput(part.output)
      if (!isEnvelope(output) || !output.ok) continue
      const issues = readIssueSummaries(output.data)
      for (const issue of issues) {
        if (issue.status !== 'done') keys.push(issue.key)
      }
    }
  }
  return keys
}

/** Did a write this turn come back `ISSUE_NOT_FOUND`? */
function sawIssueNotFound(messages: ToolMessage[]): boolean {
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue
      const output = unwrapOutput(part.output)
      if (isEnvelope(output) && !output.ok && output.error.code === 'ISSUE_NOT_FOUND') return true
    }
  }
  return false
}

/** Keys a `search_issues` result offered this turn, best match first. */
function searchMatchKeys(messages: ToolMessage[]): string[] {
  const keys: string[] = []
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolName !== 'search_issues') continue
      const output = unwrapOutput(part.output)
      if (!isEnvelope(output) || !output.ok) continue
      const data = output.data
      if (typeof data !== 'object' || data === null || !('matches' in data)) continue
      const { matches } = data
      if (!Array.isArray(matches)) continue
      for (const match of matches) {
        if (typeof match === 'object' && match !== null && 'key' in match) {
          const { key } = match
          if (typeof key === 'string') keys.push(key)
        }
      }
    }
  }
  return keys
}

/**
 * The recovery half of scenario S-E. A status change against a key that does
 * not exist comes back `ISSUE_NOT_FOUND`, and the honest next move — the one
 * the system prompt asks for in so many words — is to search for what the user
 * probably meant rather than retry or guess. Without this the scenario stops
 * at the error.
 */
function recoveryCalls(
  text: string,
  gathered: ToolMessage[],
  availableTools: ReadonlySet<string>,
): MockToolCall[] {
  if (!availableTools.has('search_issues')) return []
  if (!sawIssueNotFound(gathered)) return []
  // Only once: if a search already ran this turn, the answer is the next step.
  if (searchMatchKeys(gathered).length > 0) return []
  if (
    gathered.some((m) =>
      m.content.some((p) => p.type === 'tool-result' && p.toolName === 'search_issues'),
    )
  ) {
    return []
  }
  return [{ toolName: 'search_issues', input: { query: searchSubjectFrom(text) } }]
}

/**
 * The question that closes S-E's recovery turn (step 5): once a bad key has
 * been searched for, offer the best match back instead of acting on it. "Yes,
 * that one." on the next turn only makes sense as the answer to this.
 */
function recoveryQuestion(gathered: ToolMessage[]): string[] {
  if (!sawIssueNotFound(gathered)) return []
  for (const message of gathered) {
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolName !== 'search_issues') continue
      const output = unwrapOutput(part.output)
      if (!isEnvelope(output) || !output.ok) continue
      const [best] = (output.data as SearchIssuesData).matches
      if (best !== undefined) return [`Did you mean ${best.key} "${best.title}" (${best.status})?`]
    }
  }
  return []
}

/**
 * The part of "Mark DS-42 as done — the billing export shipped this morning"
 * that identifies the issue: the explanation, with the failed key and the
 * instruction stripped out.
 */
function searchSubjectFrom(text: string): string {
  const withoutKey = text.replace(/\bds-\d+\b/gi, ' ')
  const afterDash = /[—–-]\s*(.+)$/.exec(withoutKey)?.[1]
  const subject = (afterDash ?? withoutKey)
    .replace(
      /\b(mark|set|move|close|reopen|flag|put|as|done|todo|blocked|the|this|morning|shipped|landed)\b/gi,
      ' ',
    )
    .replace(/[?.!,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return subject.length > 0 ? subject : searchQueryFrom(text)
}

/**
 * "Close out the sprint" becomes one gated write per open issue — never a batch
 * call, so each mutation gets its own approval (docs/tool-inventory.md §3).
 * Driven by the issues the `list_issues` result actually returned, so the mock
 * stays grounded rather than hard-coding keys.
 */
/**
 * "Yes, that one." — the user confirming the issue the search offered. The key
 * comes from the conversation rather than the sentence, because the sentence
 * does not contain one.
 */
function confirmationCalls(
  text: string,
  prompt: LanguageModelV3Prompt,
  availableTools: ReadonlySet<string>,
): MockToolCall[] {
  if (!availableTools.has('update_issue_status')) return []
  if (!/^\s*(yes|yep|yeah|correct|that one|right)\b/i.test(text)) return []

  // The search that prompted the question ran in an earlier turn, so look back
  // across the whole prompt rather than only this turn's tool messages.
  const earlier = prompt.filter((message): message is ToolMessage => message.role === 'tool')
  const key = searchMatchKeys(earlier).at(0)
  if (key === undefined) return []
  if (issueKeysAlreadyRequested(prompt).has(key)) return []
  return [{ toolName: 'update_issue_status', input: { issueKey: key, status: 'done' } }]
}

function closeOutCalls(
  text: string,
  prompt: LanguageModelV3Prompt,
  gathered: ToolMessage[],
  availableTools: ReadonlySet<string>,
): MockToolCall[] {
  if (!availableTools.has('update_issue_status')) return []
  if (!/clos|wrap up|mark every|every remaining|all remaining|finish the sprint/i.test(text)) {
    return []
  }
  const already = issueKeysAlreadyRequested(prompt)
  return openIssueKeysFromResults(gathered)
    .filter((key) => !already.has(key))
    .map((key) => ({ toolName: 'update_issue_status', input: { issueKey: key, status: 'done' } }))
}

/** The most recent user turn — the one the current plan answers. */
function lastUserText(prompt: LanguageModelV3Prompt): string {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const text = userTextOf(prompt[index])
    if (text.length > 0) return text
  }
  return ''
}

/** Tool messages since that user turn, i.e. how far through the plan we are. */
function toolMessagesSinceUserTurn(prompt: LanguageModelV3Prompt): ToolMessage[] {
  const lastUserIndex = prompt.findLastIndex((message) => message.role === 'user')
  return prompt
    .slice(lastUserIndex + 1)
    .filter((message): message is ToolMessage => message.role === 'tool')
}

/**
 * Drives the agent loop: on a user turn it emits the plan's first tool call, on
 * each tool turn the next one, and once the plan is exhausted it writes the
 * answer from every tool result gathered this turn. That is what makes the mock
 * exercise multi-step chaining rather than a single round-trip.
 */
export function scriptChunks(options: LanguageModelV3CallOptions): LanguageModelV3StreamPart[] {
  const text = lastUserText(options.prompt)
  const available = availableToolNames(options)
  const plan = planUserText(text, available)
  const gathered = toolMessagesSinceUserTurn(options.prompt)
  const next = plan[gathered.length]

  // Two turns answer an earlier one rather than standing alone: "Looks good,
  // save it" (S-A step 6) and "Yes, that one" (S-E). Neither sentence says
  // what to act on, so the plan built from its words is only the fallback —
  // which would otherwise pre-empt the thing the user actually asked for.
  const opening = gathered.length === 0
  const save = opening ? saveReleaseNotesCalls(text, options.prompt, available) : []
  const confirmed = opening ? confirmationCalls(text, options.prompt, available) : []

  let body: LanguageModelV3StreamPart[]
  if (save.length > 0) {
    body = toolCallChunks(save)
  } else if (confirmed.length > 0) {
    body = toolCallChunks(confirmed)
  } else if (next !== undefined) {
    body = next.kind === 'text' ? textChunks(next.text) : toolCallChunks([next])
  } else {
    // Reads are done. A close-out request now turns each open issue into its own
    // gated write; anything else goes straight to the answer.
    const writes = closeOutCalls(text, options.prompt, gathered, available)
    const diff = releaseNotesDiffCalls(text, gathered, available)
    const recovery = recoveryCalls(text, gathered, available)
    if (writes.length > 0) {
      body = toolCallChunks(writes)
    } else if (diff.length > 0) {
      body = toolCallChunks(diff)
    } else if (recovery.length > 0) {
      body = toolCallChunks(recovery)
    } else {
      const inputs = inputsByToolCallId(options.prompt)
      const summary = [
        ...gathered.map((message) => summarizeToolMessage(message, inputs)),
        ...recoveryQuestion(gathered),
      ].join(' ')
      body = textChunks(summary.length > 0 ? summary : 'I have nothing to report.')
    }
  }
  return [{ type: 'stream-start', warnings: [] }, ...body]
}

export function createMockModel(): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'devsprint-mock',
    modelId: 'scripted',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('devsprint-mock supports streaming only')),
    doStream: (options) =>
      Promise.resolve({
        stream: simulateReadableStream({ chunks: scriptChunks(options), chunkDelayInMs: 15 }),
      }),
  }
}
