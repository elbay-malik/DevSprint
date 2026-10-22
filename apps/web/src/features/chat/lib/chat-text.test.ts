import { describe, expect, it } from 'vitest'
import { parseChatText, parseInline } from './chat-text'

describe('parseInline', () => {
  it('reads bold, italic and code, and leaves everything else as text', () => {
    expect(parseInline('a **b** _c_ *d* `e` f')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'em', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'em', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'e' },
      { kind: 'text', text: ' f' },
    ])
  })

  it('leaves an unclosed marker literal, as in a half-streamed answer', () => {
    expect(parseInline("**Ben's open")).toEqual([{ kind: 'text', text: "**Ben's open" }])
  })

  it('does not read snake_case or 2*3*4 as emphasis', () => {
    expect(parseInline('status in_review, 2 * 3 * 4')).toEqual([
      { kind: 'text', text: 'status in_review, 2 * 3 * 4' },
    ])
  })

  it('keeps link syntax as plain text, never a link', () => {
    expect(parseInline('[click](https://evil.example)')).toEqual([
      { kind: 'text', text: '[click](https://evil.example)' },
    ])
  })
})

describe('parseChatText', () => {
  it('turns what the live model wrote into a paragraph, headings and lists', () => {
    // gpt-oss-120b's answer on the live demo, 2026-10-22, verbatim.
    const answer = [
      'Ben Osei (u‑ben) and Chidi Okafor (u‑chidi) each have the most open work – two issues each.',
      '',
      '**Ben’s open issues**',
      '- DS‑7 “Billing export CSV download” – in_review',
      '- DS‑9 “Notification preferences page” – in_progress',
      '',
      '**Chidi’s open issues**',
      '- DS‑8 “Unsubscribe link 404s on staging” – in_review',
    ].join('\n')

    const blocks = parseChatText(answer)
    expect(blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'paragraph',
      'list',
      'paragraph',
      'list',
    ])
    expect(blocks[1]).toEqual({
      kind: 'paragraph',
      lines: [[{ kind: 'strong', text: 'Ben’s open issues' }]],
    })
    expect(blocks[2]).toMatchObject({ kind: 'list', ordered: false })
    expect(blocks[2]?.kind === 'list' && blocks[2].items).toHaveLength(2)
  })

  it('reads a table only when its header has the --- rule under it', () => {
    const blocks = parseChatText(
      '| Key | Status |\n|---|---|\n| DS-7 | Done |\n| DS-8 | Todo |\nafter',
    )
    expect(blocks[0]).toMatchObject({ kind: 'table' })
    expect(blocks[0]?.kind === 'table' && blocks[0].rows).toHaveLength(2)
    expect(blocks[1]).toMatchObject({ kind: 'paragraph' })

    expect(parseChatText('| just a pipe line |')[0]).toMatchObject({ kind: 'paragraph' })
  })

  it('keeps numbered and bulleted lists apart', () => {
    const blocks = parseChatText('1. one\n2. two\n- three')
    expect(blocks.map((block) => block.kind === 'list' && block.ordered)).toEqual([true, false])
  })

  it('shows headings as emphasised paragraphs', () => {
    expect(parseChatText('## Sprint 12')[0]).toEqual({
      kind: 'heading',
      content: [{ kind: 'text', text: 'Sprint 12' }],
    })
  })
})
