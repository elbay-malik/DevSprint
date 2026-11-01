/** The most characters one message from the person may hold. */
export const MAX_USER_MESSAGE_CHARS = 4_000

/** How many messages of a conversation reach the model. */
export const MAX_HISTORY_MESSAGES = 20

/**
 * How much of a conversation reaches the model, in serialized characters. About
 * 8,000 tokens, which is Groq's free-tier limit for a minute (ADR-0021).
 */
export const MAX_HISTORY_CHARS = 32_000

/**
 * The part of a conversation worth sending to the model: the person's latest
 * message and everything after it, then as much of what came before as fits.
 *
 * The latest message and what follows it are never dropped, however large they
 * are. That is the turn in progress, and an approval resume is meaningless
 * without it. Older messages are dropped rather than refused, because the SPA
 * resends the whole transcript and a refusal would strand a long conversation
 * for good. The model loses that memory, but it reads the board through its tools.
 *
 * What is kept starts on a user message, so a tool call is never separated from
 * the message holding its result, and the model never opens on its own reply.
 */
export function trimChatHistory<MESSAGE extends { role: string }>(messages: MESSAGE[]): MESSAGE[] {
  let lastUser = messages.length - 1
  while (lastUser >= 0 && messages[lastUser]!.role !== 'user') lastUser -= 1
  if (lastUser <= 0) return messages

  const size = (message: MESSAGE) => JSON.stringify(message).length
  let chars = messages.slice(lastUser).reduce((total, message) => total + size(message), 0)
  let start = lastUser
  for (let index = lastUser - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    chars += size(message)
    if (chars > MAX_HISTORY_CHARS || messages.length - index > MAX_HISTORY_MESSAGES) break
    if (message.role === 'user') start = index
  }
  return messages.slice(start)
}
