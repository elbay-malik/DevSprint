import type { UIMessage } from 'ai'

/** Concatenates the text parts of the most recent user message. */
export function extractLastUserText(messages: UIMessage[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  if (!lastUser) return ''
  return lastUser.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

/** Splits text into whitespace-preserving tokens for a word-by-word stream. */
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? []
}
