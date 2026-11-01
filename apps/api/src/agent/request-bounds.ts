/**
 * What a chat request may hold before anything is spent on it.
 *
 * The transcript is client-held and arrives whole, so these run on the raw body,
 * ahead of the rate limit, and refuse what the SPA can never send. Anything the
 * SPA can reach gets trimmed instead (`trimChatHistory`), because a refusal it
 * can run into would come back on every later turn and strand the conversation.
 */
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

/** Why this transcript is refused, or undefined when it may go on to be validated. */
export function chatRequestRefusal(messages: unknown[]): string | undefined {
  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'user' || !Array.isArray(message.parts)) continue
    for (const part of message.parts as unknown[]) {
      if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') continue
      if (part.text.length > MAX_USER_MESSAGE_CHARS) {
        return `A message can be at most ${MAX_USER_MESSAGE_CHARS} characters.`
      }
    }
  }
  return undefined
}
