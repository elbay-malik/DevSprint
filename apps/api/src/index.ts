import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai'
import { API_ROUTES } from '@devsprint/shared'
import { extractLastUserText, tokenize } from './lib/echo'

const app = new Hono<{ Bindings: Env }>()

// env bindings are only available per-request, so the cors middleware is
// constructed inside the handler instead of at module scope
app.use('/api/*', (c, next) =>
  cors({
    origin: c.env.CORS_ORIGIN,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 86400,
  })(c, next),
)

app.get('/api/health', (c) => c.json({ ok: true }))

app.post(API_ROUTES.chat, async (c) => {
  const body = await c.req.json<{ messages?: UIMessage[] }>()
  const userText = extractLastUserText(body.messages ?? [])
  const reply = userText ? `Echo: ${userText}` : 'Say something and I will echo it back.'

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const id = crypto.randomUUID()
      writer.write({ type: 'text-start', id })
      for (const token of tokenize(reply)) {
        writer.write({ type: 'text-delta', id, delta: token })
        // I/O wait — does not count toward the Workers CPU budget
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      writer.write({ type: 'text-end', id })
    },
  })

  // 'Content-Encoding: Identity' defeats wrangler dev/miniflare response
  // buffering so tokens actually stream locally (workers-sdk#8004); harmless
  // in production.
  return createUIMessageStreamResponse({
    stream,
    headers: { 'Content-Encoding': 'Identity' },
  })
})

export default app
