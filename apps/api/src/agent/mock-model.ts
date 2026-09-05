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
  DeploymentHistoryData,
  ListIssuesData,
  ReleaseNotesDiffData,
  SearchIssuesData,
  SprintStatusData,
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

export type MockDecision =
  | { kind: 'tool-call'; toolName: string; input: Record<string, unknown> }
  | { kind: 'text'; text: string }

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
  if (/deploy|shipped|rolled out/i.test(text)) {
    const environment = environmentFrom(text)
    candidates.push({
      kind: 'tool-call',
      toolName: 'get_deployment_history',
      input: environment === undefined ? {} : { environment },
    })
  }
  if (/burndown|on track|trend|velocity/i.test(text)) {
    candidates.push({ kind: 'tool-call', toolName: 'get_burndown', input: {} })
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
      { kind: 'tool-call', toolName: 'get_sprint_status', input: {} },
      {
        kind: 'tool-call',
        toolName: 'list_issues',
        input: { sprintId: 'sprint-12', status: 'done' },
      },
    )
  }
  if (/summar|how is|how are|health/i.test(text)) {
    candidates.push({ kind: 'tool-call', toolName: 'get_sprint_status', input: {} })
  }
  if (
    /list|show|which issues|what issues|done issues|blocked issues|in review|in progress/i.test(
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
  return `Burndown for ${data.sprintId} as of ${today.date}: ${today.remaining} of ${data.committedPoints} points remaining vs ${today.ideal} ideal — ${verdict}.`
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

function summarizeToolMessage(message: ToolMessage): string {
  const summaries = message.content.flatMap((part) =>
    part.type === 'tool-result'
      ? [summarizeToolOutput(part.toolName, unwrapOutput(part.output))]
      : [],
  )
  return summaries.length > 0 ? summaries.join(' ') : 'The tool returned no result.'
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

function toolCallChunks(
  toolName: string,
  input: Record<string, unknown>,
): LanguageModelV3StreamPart[] {
  return [
    { type: 'tool-call', toolCallId: crypto.randomUUID(), toolName, input: JSON.stringify(input) },
    finish('tool-calls'),
  ]
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
  const plan = planUserText(lastUserText(options.prompt), availableToolNames(options))
  const done = toolMessagesSinceUserTurn(options.prompt)
  const next = plan[done.length]

  let body: LanguageModelV3StreamPart[]
  if (next === undefined) {
    // Plan exhausted: answer from everything gathered, oldest first.
    const summary = done.map(summarizeToolMessage).join(' ')
    body = textChunks(summary.length > 0 ? summary : 'I have nothing to report.')
  } else if (next.kind === 'text') {
    body = textChunks(next.text)
  } else {
    body = toolCallChunks(next.toolName, next.input)
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
