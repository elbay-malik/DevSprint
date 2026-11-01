import { simulateReadableStream } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeWorkspaceBinding } from '../test/workspace-binding'
import type { LanguageModelV3, LanguageModelV3CallOptions } from './agent/provider-types'

/**
 * What the route hands the model, read off the call itself. A stubbed provider
 * response can't show this, because Groq drops what it does not use on the way
 * to the wire, which would pass with or without the code under test.
 */
const seen: LanguageModelV3CallOptions[] = []

const model: LanguageModelV3 = {
  specificationVersion: 'v3',
  provider: 'test',
  modelId: 'records-its-prompt',
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error('streaming only')),
  doStream: (options) => {
    seen.push(options)
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
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
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

  it('keeps provider metadata on assistant parts, or Gemini loses its thought signature', async () => {
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
})
