import { simulateReadableStream } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeWorkspaceBinding } from '../test/workspace-binding'
import { createWorkspaceStore } from './workspace/store'
import { MODEL_ISSUE_LIST_CHARS } from './agent/model-output'
import type { LanguageModelV3, LanguageModelV3CallOptions } from './agent/provider-types'

/**
 * What the route hands the model, read off the call itself. A stubbed provider
 * response can't show this, because Groq drops what it does not use on the way
 * to the wire, which would pass with or without the code under test.
 */
const seen: LanguageModelV3CallOptions[] = []

/** Set by a test to make the next step call a tool instead of answering. */
let nextToolCall: { toolName: string; input: unknown } | undefined

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

const model: LanguageModelV3 = {
  specificationVersion: 'v3',
  provider: 'test',
  modelId: 'records-its-prompt',
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error('streaming only')),
  doStream: (options) => {
    seen.push(options)
    const toolCall = nextToolCall
    nextToolCall = undefined
    if (toolCall) {
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            {
              type: 'tool-call',
              toolCallId: 'c1',
              toolName: toolCall.toolName,
              input: JSON.stringify(toolCall.input),
            },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: undefined },
              usage: USAGE,
            },
          ],
          chunkDelayInMs: 0,
        }),
      })
    }
    return Promise.resolve({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'ok' },
          { type: 'text-end', id: 't1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: USAGE,
          },
        ],
        chunkDelayInMs: 0,
      }),
    })
  },
}

vi.mock('./agent/model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agent/model')>()),
  resolveModel: () => ({ model, label: 'stub' }),
}))

const { default: app } = await import('./index')

async function promptFor(messages: unknown[]) {
  const res = await app.request(
    '/api/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    },
    {
      CORS_ORIGIN: 'http://localhost:5173',
      WORKSPACE: fakeWorkspaceBinding().binding,
      DAILY_TOKEN_CAP: '0',
    },
  )
  expect(res.status).toBe(200)
  await res.text()
  const prompt = seen.at(-1)?.prompt
  if (!prompt) throw new Error('the model was never called')
  return prompt.filter((message) => message.role !== 'system')
}

describe('the prompt a chat request becomes', () => {
  beforeEach(() => {
    seen.length = 0
    nextToolCall = undefined
  })

  it('carries no provider options a client put on a user part', async () => {
    const prompt = await promptFor([
      {
        id: 'u1',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'hello',
            providerMetadata: { anything: { smuggled: 'by-the-client' } },
          },
        ],
      },
    ])

    expect(prompt[0]?.role).toBe('user')
    expect(JSON.stringify(prompt)).toContain('hello')
    expect(JSON.stringify(prompt)).not.toContain('by-the-client')
  })

  it('keeps provider metadata on assistant parts, which the provider wrote itself', async () => {
    const prompt = await promptFor([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'tool-get_sprint_status',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: { ok: true, data: {} },
            callProviderMetadata: { google: { thoughtSignature: 'keep-me' } },
          },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'second' }] },
    ])

    expect(JSON.stringify(prompt)).toContain('keep-me')
  })

  describe('with a board full of the longest issues the schemas allow', () => {
    const LONG_TITLE = `Poisoned ${'x'.repeat(191)}`

    function fullBoard() {
      const store = createWorkspaceStore()
      const issues = store.get().issues
      const template = issues[0]!
      for (let n = 0; n < 40; n += 1) {
        issues.push({
          ...template,
          id: `ds-${100 + n}`,
          key: `DS-${100 + n}`,
          title: LONG_TITLE,
          labels: Array.from({ length: 10 }, (_, i) => `${i}${'y'.repeat(39)}`),
        })
      }
      return store
    }

    it('shows the model the short copy and the cards the whole one', async () => {
      nextToolCall = { toolName: 'list_issues', input: { limit: 200 } }
      const res = await app.request(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'list them' }] }],
          }),
        },
        {
          CORS_ORIGIN: 'http://localhost:5173',
          WORKSPACE: fakeWorkspaceBinding(fullBoard()).binding,
          DAILY_TOKEN_CAP: '0',
        },
      )
      const stream = await res.text()

      // The step after the tool ran, which is the one that pays for its result.
      expect(seen).toHaveLength(2)
      const toolMessage = JSON.stringify(
        seen[1]?.prompt.filter((message) => message.role === 'tool'),
      )
      expect(toolMessage).toContain('"truncated":true')
      expect(toolMessage).not.toContain(LONG_TITLE)
      expect(toolMessage.length).toBeLessThan(MODEL_ISSUE_LIST_CHARS + 500)

      expect(stream).toContain(LONG_TITLE)
      expect(stream).not.toContain('"truncated":true')
    })

    it('shortens a list the client resends in its history too', async () => {
      const output = {
        ok: true,
        data: {
          issues: fullBoard()
            .get()
            .issues.map(({ key, title, labels }) => ({ key, title, labels })),
        },
      }
      const prompt = await promptFor([
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'list them' }] },
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            { type: 'step-start' },
            {
              type: 'tool-list_issues',
              toolCallId: 'c1',
              state: 'output-available',
              input: { limit: 200 },
              output,
            },
          ],
        },
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'and now?' }] },
      ])

      expect(JSON.stringify(prompt)).toContain('"truncated":true')
      expect(JSON.stringify(prompt)).not.toContain(LONG_TITLE)
    })
  })
})
