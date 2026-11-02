import type { JSONValue } from 'ai'

/**
 * What the model reads of an issue list, kept apart from what the cards read.
 *
 * `list_issues` and `search_issues` return the whole title and every label, and
 * anyone can fill those fields over the public MCP server (ADR-0020). 40 issues
 * at the longest text the schemas allow come to about 30 KB, which is resent on
 * every later step and alone reaches Groq's per-minute limit (ADR-0021). Lowering
 * the tools' `limit` would not help, since the board tops out at 53 issues
 * (ADR-0024).
 *
 * So this bounds the model's copy with the SDK's `toModelOutput`, which leaves
 * the output on the UI stream alone. The cards still get every character, and
 * ADR-0016's objection to rewriting the output contract does not apply. It also
 * runs on the tool results a request carries in its history, so that JSON comes
 * from the client and its shape can't be assumed. No output gets past the limit:
 * what compacting can't shrink goes to the model as cut-off text, which nothing
 * a real tool returns ever needs. This covers these tools' outputs only. The SDK
 * skips `toModelOutput` for a part in the `output-error` state, and other tools
 * have no bound here, so for those a client's own history is held by the 256 KB
 * body limit and the daily budget.
 */
export const MODEL_ISSUE_LIST_CHARS = 12_000

/**
 * Tried in order until the JSON fits. The second step exists because the first
 * can't always fit: a full board at the first step's lengths is about 18,600
 * characters. At the second, even a title made wholly of characters JSON
 * escapes keeps 53 issues under the limit.
 */
const COMPACT_STEPS = [
  { title: 80, labels: 3 },
  { title: 40, labels: 0 },
] as const

type ModelOutput = { type: 'text'; value: string } | { type: 'json'; value: JSONValue }

/** `toModelOutput` for the two issue-list tools. Anything under the limit passes unchanged. */
export function compactIssueListForModel({ output }: { output: unknown }): ModelOutput {
  // What the SDK does for a tool with no `toModelOutput`, under the same limit.
  if (typeof output === 'string') {
    return { type: 'text', value: clip(output, MODEL_ISSUE_LIST_CHARS - 1) }
  }
  const unchanged = (output ?? null) as JSONValue
  if (fits(unchanged)) return { type: 'json', value: unchanged }

  const found = findList(output)
  if (found) {
    const { envelope, field, list } = found
    for (const step of COMPACT_STEPS) {
      const compacted = {
        ...envelope,
        data: {
          ...envelope.data,
          [field]: list.map((row) => compactRow(row, step)),
          truncated: true,
        },
      } as JSONValue
      if (fits(compacted)) return { type: 'json', value: compacted }
    }
  }
  return { type: 'text', value: clip(JSON.stringify(unchanged), MODEL_ISSUE_LIST_CHARS - 1) }
}

function fits(value: JSONValue): boolean {
  return JSON.stringify(value).length <= MODEL_ISSUE_LIST_CHARS
}

/** The list inside a successful envelope. Anything else, such as an error, has none. */
function findList(output: unknown) {
  if (!isRecord(output) || output.ok !== true || !isRecord(output.data)) return undefined
  const data = output.data
  const field = ['issues', 'matches'].find((name) => Array.isArray(data[name]))
  if (field === undefined) return undefined
  return { envelope: { ...output, data }, field, list: data[field] as unknown[] }
}

function compactRow(row: unknown, step: (typeof COMPACT_STEPS)[number]): unknown {
  if (!isRecord(row)) return row
  const { title, labels } = row
  return {
    ...row,
    ...(typeof title === 'string' ? { title: clip(title, step.title) } : {}),
    ...(Array.isArray(labels) ? { labels: labels.slice(0, step.labels) } : {}),
  }
}

/** The ellipsis tells the model the title goes on. A cut can't leave half a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '')}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
