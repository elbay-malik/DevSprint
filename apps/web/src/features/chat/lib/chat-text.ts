/**
 * The small, safe subset of markdown a model actually writes in chat, parsed
 * into plain data for the template to render (ADR-0022).
 *
 * Nothing here produces HTML. The template interpolates every string, so it is
 * escaped like any other text and there is still no `v-html` in the chat
 * (ADR-0016). Links are deliberately not recognised: a model that read
 * planted text off the public board must not be able to hand a visitor a
 * clickable URL. Anything outside the subset stays as the characters it is.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }

export type Block =
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'heading'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }

// Bold before italic, so `**x**` is never read as two empty emphases. Each
// marker needs a closing partner on the same line; an unclosed one, as in a
// half-streamed answer, stays literal until its pair arrives.
const INLINE =
  /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+)`|\*([^*\s][^*\n]*?)\*|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])/g

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) })
    const [, strong, strongAlt, code, em, emAlt] = match
    if (strong !== undefined || strongAlt !== undefined) {
      out.push({ kind: 'strong', text: strong ?? strongAlt ?? '' })
    } else if (code !== undefined) {
      out.push({ kind: 'code', text: code })
    } else {
      out.push({ kind: 'em', text: em ?? emAlt ?? '' })
    }
    last = index + match[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^\s*#{1,6}\s+(.*)$/
const TABLE_ROW = /^\s*\|(.*)\|\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

function cells(row: string): Inline[][] {
  return row.split('|').map((cell) => parseInline(cell.trim()))
}

export function parseChatText(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: Inline[][] = []

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', lines: paragraph })
    paragraph = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    const listItem = bullet ?? numbered
    const tableRow = TABLE_ROW.exec(line)
    const heading = HEADING.exec(line)

    if (line.trim() === '') {
      flush()
    } else if (listItem) {
      flush()
      const ordered = numbered !== null
      const previous = blocks.at(-1)
      const item = parseInline(listItem[1] ?? '')
      if (previous?.kind === 'list' && previous.ordered === ordered) previous.items.push(item)
      else blocks.push({ kind: 'list', ordered, items: [item] })
    } else if (tableRow && TABLE_RULE.test(lines[index + 1] ?? '')) {
      // A table needs its header and the --- rule under it; a lone `| x |`
      // line is just text.
      flush()
      const header = cells(tableRow[1] ?? '')
      const rows: Inline[][][] = []
      index += 2
      while (index < lines.length) {
        const row = TABLE_ROW.exec(lines[index] ?? '')
        if (!row) break
        rows.push(cells(row[1] ?? ''))
        index += 1
      }
      index -= 1
      blocks.push({ kind: 'table', header, rows })
    } else if (heading) {
      flush()
      blocks.push({ kind: 'heading', content: parseInline(heading[1] ?? '') })
    } else {
      paragraph.push(parseInline(line))
    }
  }
  flush()
  return blocks
}
