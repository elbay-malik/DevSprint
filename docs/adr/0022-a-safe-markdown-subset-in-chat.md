# ADR-0022: Render a safe markdown subset in chat, without `v-html`

- Status: Accepted
- Date: 2026-10-22
- Deciders: repo owner (solo project)

## Context and Problem Statement

Chat text was shown exactly as written. That was deliberate: there is no `v-html`, so nothing a
model repeats from the public board can become markup (ADR-0016). It cost nothing while the
scripted mock wrote plain sentences. With the live model (ADR-0021) it became a visible defect.
The system prompt now asked for plain text, but gpt-oss-120b answered the first free-form
question on the live site with `**Ben's open issues**` and `- ` bullets, and visitors saw the
asterisks.

A prompt instruction is a request, not a guarantee, and this model leans hard toward markdown.
Asking more firmly treats the symptom. The question is how to show formatting without giving up
what the no-`v-html` posture protects.

## Decision

The assistant's text goes through a small parser (`apps/web/src/features/chat/lib/chat-text.ts`).
It yields plain data, never HTML.

- **Blocks:** paragraphs, bullet and numbered lists, headings (shown as bold), and tables that
  have their `---` rule.
- **Inline:** bold, italic and code.

Vue renders that data with ordinary interpolation, so every string is escaped as text. Its
choices:

- **No links.** `[x](url)` stays as characters, so a model that read planted text off the board
  cannot hand a visitor a clickable URL.
- **An unclosed marker stays literal.** A half-streamed `**Ben` is not misread before its pair
  arrives.
- **`snake_case` and `2 * 3` are not emphasis,** since statuses such as `in_review` are everywhere.
- **A user's own message is shown exactly as typed.**

The system prompt now describes the formatting that renders instead of asking for plain text.

## Consequences

- Positive: a live model's answers read as intended, and the injection posture is unchanged.
  Unit tests check that an `<img onerror>` and a `<script>` arrive as text, and that link syntax
  never becomes an `<a>`.
- Negative: this is our own parser for a sliver of markdown. Nested lists, block quotes, fenced
  code and links are not supported, and appear as their characters.
- Neutral: the scripted mock writes no markdown, so the e2e suite sees no change.

## Alternatives Considered

- **A full markdown library plus a sanitiser, through `v-html`:** that reintroduces the very sink
  ADR-0016 removed, and makes the sanitiser's configuration the security boundary.
- **A markdown-to-VNode library:** this would avoid `v-html`, but it's a dependency for five
  constructs, and links would need turning off inside it anyway.
- **A firmer prompt:** already tried. The model ignored it.

## References

- [ADR-0016](0016-two-spend-controls-and-an-honest-injection-posture.md): the no-`v-html` posture
- [ADR-0021](0021-a-live-model-on-the-demo.md): the live model that made this visible
