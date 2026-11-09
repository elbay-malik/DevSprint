import { simulateReadableStream } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetApprovalSigningState } from '../agent/approvals'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '../agent/provider-types'
import { runScenario } from './harness'

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

const OPEN = ['DS-7', 'DS-8', 'DS-9', 'DS-10', 'DS-11']

/** The tool calls already in the prompt: what the model has asked for so far. */
function calledSoFar(
  options: LanguageModelV3CallOptions,
): Array<{ toolName: string; input: unknown }> {
  return options.prompt.flatMap((message) =>
    message.role === 'assistant'
      ? message.content.flatMap((part) =>
          part.type === 'tool-call' ? [{ toolName: part.toolName, input: part.input }] : [],
        )
      : [],
  )
}

/**
 * A model that asks for one write per round, the way the live one does: it
 * lists the sprint once, then closes one issue per step, reading what it has
 * already asked for off the prompt it is sent.
 */
let calls = 0
const serialModel: LanguageModelV3 = {
  specificationVersion: 'v3',
  provider: 'test',
  modelId: 'one-write-per-round',
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error('streaming only')),
  doStream: (options) => {
    const called = calledSoFar(options)
    const closed = new Set(
      called
        .filter((call) => call.toolName === 'update_issue_status')
        .map((call) => (call.input as { issueKey: string }).issueKey),
    )
    const listed = called.some((call) => call.toolName === 'list_issues')
    const next = !listed
      ? { toolName: 'list_issues', input: { sprintId: 'sprint-12' } }
      : OPEN.filter((key) => !closed.has(key)).map((issueKey) => ({
          toolName: 'update_issue_status',
          input: { issueKey, status: 'done' },
        }))[0]
    calls += 1
    const chunks: LanguageModelV3StreamPart[] = next
      ? [
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: `c${calls}`,
            toolName: next.toolName,
            input: JSON.stringify(next.input),
          },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: USAGE,
          },
        ]
      : [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'DS-11 was not approved.' },
          { type: 'text-end', id: 't1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: USAGE,
          },
        ]
    return Promise.resolve({ stream: simulateReadableStream({ chunks, chunkDelayInMs: 0 }) })
  },
}

vi.mock('../agent/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent/model')>()),
  resolveModel: () => ({ model: serialModel, label: 'test:one-write-per-round' }),
}))

describe('runScenario', () => {
  beforeEach(() => {
    calls = 0
    resetApprovalSigningState()
  })

  it('answers approvals that come one per round, as the SPA does, until the last', async () => {
    const run = await runScenario({
      steps: [
        {
          prompt: 'Close out Sprint 12.',
          decide: ({ input }) =>
            input.issueKey === 'DS-11'
              ? { approved: false, reason: 'Still blocked' }
              : { approved: true },
        },
      ],
    })

    // One card per round, five rounds, and no round fails on a resent approval.
    expect(run.turns.map((turn) => turn.approvals.length)).toEqual([1, 1, 1, 1, 1, 0])
    expect(
      run.turns.flatMap((turn) => turn.chunks).filter((chunk) => chunk.type === 'error'),
    ).toEqual([])
    // The sprint was read once: each round's history still holds the read.
    expect(run.trajectory.filter((name) => name === 'list_issues')).toHaveLength(1)

    const board = run.store.get()
    for (const key of ['DS-7', 'DS-8', 'DS-9', 'DS-10']) {
      expect(board.issues.find((issue) => issue.key === key)?.status).toBe('done')
    }
    expect(board.issues.find((issue) => issue.key === 'DS-11')?.status).toBe('blocked')
    expect(run.turns.at(-1)?.text).toBe('DS-11 was not approved.')
  })
})
