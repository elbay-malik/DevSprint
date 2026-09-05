import { describe, expect, it } from 'vitest'
import { simulateReadableStream } from 'ai'
import { createLocalWorkspaceApi, createWorkspaceStore } from '../workspace/store'
import { createCopilotAgent, MAX_STEPS } from './agent'
import { createTools } from './tools'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Usage,
} from './provider-types'

const NO_USAGE: LanguageModelV3Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
}

/** A model that never stops asking for another tool — only the budget ends it. */
function loopingModel() {
  const seen: LanguageModelV3CallOptions[] = []
  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'always-calls-a-tool',
    supportedUrls: {},
    doGenerate: () => Promise.reject(new Error('streaming only')),
    doStream: (options) => {
      seen.push(options)
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            {
              type: 'tool-call',
              toolCallId: `call-${seen.length}`,
              toolName: 'get_sprint_status',
              input: '{}',
            },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: undefined },
              usage: NO_USAGE,
            },
          ],
          chunkDelayInMs: 0,
        }),
      })
    },
  }
  return { model, seen }
}

const tools = createTools(createLocalWorkspaceApi(createWorkspaceStore()))

describe('createCopilotAgent', () => {
  it('stops a runaway loop at the step budget', async () => {
    const { model, seen } = loopingModel()
    const agent = createCopilotAgent({
      model,
      instructions: 'test',
      tools,
      approvalSecret: 'test-secret',
    })

    const result = await agent.stream({ messages: [{ role: 'user', content: 'go' }] })
    await result.consumeStream()

    // Without `stopWhen` this model would call tools forever — on a public demo
    // that is a quota incident, so the bound is the behaviour under test.
    expect(seen).toHaveLength(MAX_STEPS)
  })

  it('spends the last permitted step writing an answer, not on another tool', async () => {
    const { model, seen } = loopingModel()
    const agent = createCopilotAgent({
      model,
      instructions: 'test',
      tools,
      approvalSecret: 'test-secret',
    })

    const result = await agent.stream({ messages: [{ role: 'user', content: 'go' }] })
    await result.consumeStream()

    // Every step but the last may reach for a tool; on the last the tools are
    // withdrawn, so the budget cannot be exhausted on bare tool calls with no
    // prose to show for it.
    const choices = seen.map((call) => call.toolChoice?.type)
    expect(choices.slice(0, -1).every((choice) => choice !== 'none')).toBe(true)
    expect(choices.at(-1)).toBe('none')
  })

  it('leaves room for the three-tool chains the scenarios need', () => {
    // A chain of N tools costs N tool steps plus the step that writes the answer.
    expect(MAX_STEPS).toBeGreaterThanOrEqual(4)
  })

  it('sends the instructions as the system message', async () => {
    const { model, seen } = loopingModel()
    const agent = createCopilotAgent({
      model,
      instructions: 'YOU ARE THE COPILOT',
      tools,
      approvalSecret: 'test-secret',
    })

    const result = await agent.stream({ messages: [{ role: 'user', content: 'go' }] })
    await result.consumeStream()

    expect(seen[0]?.prompt[0]).toMatchObject({ role: 'system', content: 'YOU ARE THE COPILOT' })
  })

  it('exposes every read tool to the model', async () => {
    const { model, seen } = loopingModel()
    const agent = createCopilotAgent({
      model,
      instructions: 'test',
      tools,
      approvalSecret: 'test-secret',
    })

    const result = await agent.stream({ messages: [{ role: 'user', content: 'go' }] })
    await result.consumeStream()

    const names = (seen[0]?.tools ?? []).map((tool) => ('name' in tool ? tool.name : ''))
    expect(names.sort()).toEqual(Object.keys(tools).sort())
  })
})
