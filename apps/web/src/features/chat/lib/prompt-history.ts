/** Anything with a role and parts, so the chat's own messages fit. */
interface MessageLike {
  role: string
  parts: readonly { type: string; text?: string }[]
}

/**
 * The prompts sent this session, oldest first, read from the transcript itself
 * so it lives exactly as long as the conversation does. A prompt sent twice in
 * a row is kept once, as a shell's history does.
 */
export function promptHistory(messages: readonly MessageLike[]): string[] {
  const entries: string[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
      .trim()
    if (text && entries.at(-1) !== text) entries.push(text)
  }
  return entries
}

/** Where a walk through the history stands: the entry shown, or none. */
export interface HistoryStep {
  /** Index of the recalled entry, or undefined once back at the empty draft. */
  index: number | undefined
  text: string
}

/**
 * One press of Up or Down, like a shell. Up recalls only from an empty field or
 * while a recalled entry is still unedited, so arrowing through a draft never
 * replaces it; Down past the newest entry returns to the empty field. Returns
 * undefined when the key should do what it would do anyway.
 */
export function stepHistory(
  entries: readonly string[],
  current: HistoryStep,
  direction: 'older' | 'newer',
): HistoryStep | undefined {
  const browsing = current.index !== undefined && entries[current.index] === current.text
  if (direction === 'older') {
    if (!browsing && current.text !== '') return undefined
    const index = browsing ? (current.index as number) - 1 : entries.length - 1
    // At the oldest entry, Up stays put rather than moving the caret.
    if (index < 0) return browsing ? current : undefined
    return { index, text: entries[index] ?? '' }
  }
  if (!browsing) return undefined
  const index = (current.index as number) + 1
  if (index >= entries.length) return { index: undefined, text: '' }
  return { index, text: entries[index] ?? '' }
}
