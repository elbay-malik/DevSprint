import { expect, type APIRequestContext, type Page, type Response } from '@playwright/test'

export const API = 'http://localhost:8787'
export const MCP = 'http://localhost:8788'

/**
 * Back to the seed. The response is checked because a reset that silently
 * failed would run every later test on whatever the last one left behind.
 */
export async function resetBoard(request: APIRequestContext) {
  const res = await request.post(`${API}/api/workspace/reset`)
  expect(res.ok(), 'the board reset before this test').toBe(true)
}

/** The workspace as the api's Durable Object holds it, not as the page shows it. */
export async function storedWorkspace(request: APIRequestContext) {
  const res = await request.get(`${API}/api/workspace`)
  expect(res.ok()).toBe(true)
  return (await res.json()) as {
    issues: Array<{ key: string; title: string; status: string; sprintId: string | null }>
    releaseNotes: Array<{ version: string; status: string; markdown: string }>
    deployments: Array<{ version: string; status: string; stages: Array<{ status: string }> }>
  }
}

export async function send(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-input').press('Enter')
}

/** One line of the AI SDK's UI message stream, as the browser received it. */
export type StreamEvent = { type: string; [key: string]: unknown }

/**
 * Everything the browser was sent on /api/chat, in order, across every request
 * of a test — the first turn and each approval resume.
 *
 * The DOM says what was drawn; this says what the agent did, so a scenario's
 * trajectory assertions hold in the browser too rather than only in the eval
 * harness. It also refuses to vouch for a turn the scripted model did not
 * serve: a reused local api started without `--var MODEL_PROVIDER:mock` would
 * otherwise run the suite against a live provider and still look green.
 */
export function recordStream(page: Page) {
  const bodies: Array<
    Promise<{ model: string | undefined; tools: string | undefined; body: string }>
  > = []
  page.on('response', (res: Response) => {
    if (!res.url().endsWith('/api/chat') || res.request().method() !== 'POST') return
    const headers = res.headers()
    bodies.push(
      res.text().then((body) => ({
        model: headers['x-devsprint-model'],
        tools: headers['x-devsprint-tools'],
        body,
      })),
    )
  })

  async function events(): Promise<StreamEvent[]> {
    const all = await Promise.all(bodies)
    for (const { model, tools } of all) {
      expect(model, 'the turn was served by the scripted model').toBe('mock')
      expect(tools, 'the issue tools came over MCP, not the local fallback').toBe('mcp')
    }
    return all.flatMap(({ body }) =>
      body
        .split('\n')
        .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
        .map((line) => JSON.parse(line.slice('data: '.length)) as StreamEvent),
    )
  }

  return {
    events,
    /** The tool calls the agent made, in order, with their arguments. */
    async calls() {
      return (await events())
        .filter((event) => event.type === 'tool-input-available')
        .map((event) => ({
          id: event.toolCallId as string,
          name: event.toolName as string,
          input: event.input as Record<string, unknown>,
        }))
    },
    /** Final (non-preliminary) outputs by tool call id. */
    async outputs() {
      const outputs = new Map<string, unknown>()
      for (const event of await events()) {
        if (event.type === 'tool-output-available' && event.preliminary !== true) {
          outputs.set(event.toolCallId as string, event.output)
        }
      }
      return outputs
    },
    /** Every text delta the agent streamed, joined. */
    async text() {
      return (await events())
        .filter((event) => event.type === 'text-delta')
        .map((event) => event.delta as string)
        .join('')
    },
  }
}

/** The settled composer is the signal a turn has finished streaming. */
export async function turnSettled(page: Page, timeout = 15_000) {
  await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout })
}
