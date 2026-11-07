/**
 * What a chat request may hold before anything is spent on it.
 *
 * The transcript is client-held and arrives whole, so these run on the raw body,
 * ahead of the rate limit, and refuse what the SPA can never send. Anything the
 * SPA can reach gets trimmed instead (`trimChatHistory`), because a refusal it
 * can run into would come back on every later turn and strand the conversation.
 *
 * The undo and cancel routes have their own, much smaller bounds below.
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

/**
 * The whole body of an undo or a cancel, in bytes. Each carries one id, so the
 * SPA sends a few dozen bytes, and anything near this is not from it.
 */
export const MAX_BOARD_WRITE_BODY_BYTES = 4 * 1024

/**
 * The longest id an undo or a cancel may name, checked before the request goes
 * on to the workspace. Every id these routes take is minted by the server: a
 * `crypto.randomUUID()` (36 characters) for a change id or a cancel token, and
 * `dep-<n>` for a deployment. The ceiling matches the one on change and
 * approval ids.
 */
export const MAX_BOARD_WRITE_ID_LENGTH = 64

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Why this transcript is refused, or undefined when it may go on to be validated.
 *
 * A system message would give the client the system prompt's authority, and the
 * SDK's schema lets one through. A non-text user part is only ever a file, which
 * the Worker would fetch from a URL the client chose. A provider-executed tool
 * part has its result written into the assistant message, where the SDK does not
 * look for it, and this agent has no such tools. The SPA sends none of these, so
 * refusing them costs it nothing.
 */
export function chatRequestRefusal(messages: unknown[]): string | undefined {
  for (const message of messages) {
    if (!isRecord(message)) continue
    if (message.role === 'system') return 'System messages are not accepted.'
    if (!Array.isArray(message.parts)) continue
    for (const part of message.parts as unknown[]) {
      if (isRecord(part) && part.providerExecuted === true) {
        return 'Provider-executed tool parts are not accepted.'
      }
      if (message.role !== 'user') continue
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
 * The keys a UI part carries provider metadata under: `providerMetadata` on text,
 * reasoning, file and source parts, and `callProviderMetadata` and
 * `resultProviderMetadata` on tool parts.
 */
const PROVIDER_METADATA_KEYS = [
  'providerMetadata',
  'callProviderMetadata',
  'resultProviderMetadata',
] as const

/**
 * The transcript with provider metadata removed from every part of every role.
 *
 * The transcript is client-held, so this metadata is whatever the client sent,
 * whichever role it sits under. The conversion copies it into the prompt's
 * provider options, where it would be counted towards the turn's spend though
 * the provider never reads it. Groq, the only provider (ADR-0026), writes none,
 * so the SPA loses nothing. An approval does not depend on it either: its
 * signature is on `part.approval`.
 *
 * Returns a copy of the messages it changes, and leaves the rest as they are.
 */
export function stripProviderMetadata<MESSAGE extends UIMessage>(messages: MESSAGE[]): MESSAGE[] {
  const hasMetadata = (part: object) => PROVIDER_METADATA_KEYS.some((key) => key in part)
  return messages.map((message) =>
    message.parts.some(hasMetadata)
      ? {
          ...message,
          parts: message.parts.map((part) => {
            if (!hasMetadata(part)) return part
            const stripped: Record<string, unknown> = { ...part }
            for (const key of PROVIDER_METADATA_KEYS) delete stripped[key]
            return stripped as typeof part
          }),
        }
      : message,
  )
}
