/**
 * What a chat request may hold before anything is spent on it.
 *
 * The transcript is client-held and arrives whole, so these run on the raw body,
 * ahead of the rate limit, and refuse what the SPA can never send. Anything the
 * SPA can reach gets trimmed instead (`trimChatHistory`), because a refusal it
 * can run into would come back on every later turn and strand the conversation.
 */
import type { UIMessage } from 'ai'
import { MAX_USER_MESSAGE_CHARS } from '@devsprint/shared'

/**
 * The whole request, in bytes. Well above what the SPA sends, since it trims to
 * the same history as the server does. A single turn can still run large: one
 * approval carries release notes of up to 20,000 characters, and a bulk step
 * carries a card per issue.
 */
export const MAX_CHAT_BODY_BYTES = 256 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Why this transcript is refused, or undefined when it may go on to be validated.
 *
 * A system message would give the client the system prompt's authority, and the
 * SDK's schema lets one through. A non-text user part is only ever a file, which
 * the Worker would fetch from a URL the client chose. The SPA sends text and
 * nothing else, so neither costs it anything.
 */
export function chatRequestRefusal(messages: unknown[]): string | undefined {
  for (const message of messages) {
    if (!isRecord(message)) continue
    if (message.role === 'system') return 'System messages are not accepted.'
    if (message.role !== 'user' || !Array.isArray(message.parts)) continue
    for (const part of message.parts as unknown[]) {
      if (!isRecord(part) || part.type !== 'text') {
        return 'A user message can only hold text.'
      }
      if (typeof part.text === 'string' && part.text.length > MAX_USER_MESSAGE_CHARS) {
        return `A message can be at most ${MAX_USER_MESSAGE_CHARS} characters.`
      }
    }
  }
  return undefined
}

/**
 * The transcript with client-supplied provider options removed from user text,
 * where the conversion would otherwise pass them straight to the provider.
 *
 * User parts only. On assistant parts this same metadata is how Gemini gets its
 * thought signature back on an approval resume, and it degrades without it.
 *
 * Returns a copy of the messages it changes, and leaves the rest as they are.
 */
export function stripUserProviderMetadata<MESSAGE extends UIMessage>(
  messages: MESSAGE[],
): MESSAGE[] {
  return messages.map((message) =>
    message.role === 'user' && message.parts.some((part) => 'providerMetadata' in part)
      ? {
          ...message,
          parts: message.parts.map((part) => {
            const stripped = { ...part }
            delete (stripped as { providerMetadata?: unknown }).providerMetadata
            return stripped
          }),
        }
      : message,
  )
}
