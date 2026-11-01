---
name: DevSprint Copilot
description: An AI copilot for a sprint board, rendered as a calm two-pane control room in ink and paper.
colors:
  paper: 'oklch(1 0 0)'
  paper-tint: 'oklch(0.97 0 0)'
  rule: 'oklch(0.922 0 0)'
  pencil: 'oklch(0.708 0 0)'
  graphite: 'oklch(0.556 0 0)'
  charcoal: 'oklch(0.269 0 0)'
  lead: 'oklch(0.371 0 0)'
  ink: 'oklch(0.205 0 0)'
  deep-ink: 'oklch(0.145 0 0)'
  bright-paper: 'oklch(0.985 0 0)'
  stop-red: 'oklch(0.577 0.245 27.325)'
  stop-red-dark: 'oklch(0.704 0.191 22.216)'
  go-green: 'oklch(0.508 0.118 165.612)'
  go-green-dark: 'oklch(0.765 0.177 163.223)'
  trace-blue: 'oklch(0.55 0.163 255.53)'
  trace-blue-dark: 'oklch(0.622 0.161 255.05)'
typography:
  headline:
    fontFamily: 'Geist Variable, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: 1.556
  stat:
    fontFamily: 'Geist Variable, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 500
    lineHeight: 1.333
    fontFeature: 'tnum'
  title:
    fontFamily: 'Geist Variable, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 600
    lineHeight: 1.429
  body:
    fontFamily: 'Geist Variable, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.429
  caption:
    fontFamily: 'Geist Variable, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.333
  label:
    fontFamily: 'Geist Variable, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: 1.333
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.333
  chart-label:
    fontFamily: 'Geist Variable, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 400
    lineHeight: 1
    fontFeature: 'tnum'
rounded:
  sm: '6px'
  md: '8px'
  lg: '10px'
  xl: '14px'
  pill: '2rem'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
components:
  button-primary:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.bright-paper}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    padding: '0 10px'
    height: '32px'
  button-outline:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.deep-ink}'
    rounded: '{rounded.md}'
    padding: '0 10px'
    height: '28px'
  button-ghost:
    textColor: '{colors.deep-ink}'
    rounded: '{rounded.md}'
    padding: '0 10px'
    height: '28px'
  button-secondary:
    backgroundColor: '{colors.paper-tint}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '0 10px'
    height: '28px'
  input:
    textColor: '{colors.deep-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    padding: '4px 10px'
    height: '32px'
  badge-secondary:
    backgroundColor: '{colors.paper-tint}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
    height: '20px'
  badge-outline:
    textColor: '{colors.deep-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
    height: '20px'
  board-card:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.deep-ink}'
    rounded: '{rounded.xl}'
    padding: '12px'
  chat-card:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.deep-ink}'
    typography: '{typography.caption}'
    rounded: '{rounded.md}'
    padding: '8px 12px'
  bubble-user:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.bright-paper}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    padding: '8px 12px'
  bubble-assistant:
    backgroundColor: '{colors.paper-tint}'
    textColor: '{colors.deep-ink}'
    typography: '{typography.body}'
    rounded: '{rounded.lg}'
    padding: '8px 12px'
  suggestion-chip:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.deep-ink}'
    typography: '{typography.label}'
    rounded: '{rounded.pill}'
    padding: '0 10px'
    height: '28px'
---

# Design System: DevSprint Copilot

## Overview

**Creative North Star: "The Control Room"**

DevSprint is a quiet control room for a sprint. Two panes sit side by side with no chrome between
them but a hairline: the board on the left and the copilot on the right, so cause and effect are
always in the same view. The room is drawn in ink and paper. Every surface, word and divider is a
step on one zero-chroma ramp, so the eye rests until something needs it. Colour is a signal, not a
mood. It appears where a stage succeeds, a write fails, or a data line traces the sprint, and
nowhere else.

Density is calm, not cramped. Workspace chrome sits at 14px and chat cards at 12px, with one
typeface throughout. Monospace marks anything that is an identifier, and tabular figures keep
every number in its column. Surfaces are flat. They are separated by 1px rings at 10% opacity and
by tonal steps, never by drop shadows at rest. Corners are gently rounded, from 8px on chat cards
to 14px on board cards, and the system is meant to feel soft and approachable, not clinical: the
next layer of work warms the interactions rather than adding ornament.

The system is fully themed. Light is paper with ink, and dark is ink with paper. Both are tokens
on `:root` and `.dark`, toggled by a class on `<html>`, and both must hold WCAG 2.2 AA.

**Key Characteristics:**

- One neutral ramp at zero chroma carries the whole interface; hue appears only as a signal.
- Flat surfaces: hairline rings and tonal steps, no shadows at rest.
- One typeface (Geist), with monospace for identifiers and tabular figures for numbers.
- State is always a word, code or glyph first, and a colour second.
- Gently rounded, soft forms (6 to 14px, and pills for badges).

## Colors

An achromatic ink-and-paper ramp, with three signal hues that each carry a meaning.

### Primary

- **Ink** (oklch(0.205 0 0)): the one affirmative action per region (Send, Approve), or the safe
  default (Deny) when the affirmative cannot land, and the user's own chat bubble. In dark mode the
  roles invert: the primary fill becomes Rule (oklch(0.922 0 0)) with Ink text. The user's bubble
  does not follow it there: a Rule bubble was the brightest block on a dark screen, so in dark it
  is Lead (see Neutral), through its own `--bubble-user` token.

### Neutral

- **Paper** (oklch(1 0 0)): the page, board cards, and the inset surface of every chat card. In
  dark mode, Deep Ink is the page and Ink the cards.
- **Paper Tint** (oklch(0.97 0 0)): assistant bubbles, secondary badges, the progress track,
  hover fills. In dark mode, Charcoal.
- **Rule** (oklch(0.922 0 0)): every border, divider and input stroke. In dark mode, Paper at 10%
  for borders and 15% for inputs.
- **Pencil** (oklch(0.708 0 0)): the dark-mode secondary text colour and the dark-mode focus ring
  (`--ring`), at 5.8:1 or more on every dark surface.
- **Graphite** (oklch(0.556 0 0)): secondary text everywhere, meaning captions, labels, keys,
  column headings, the ideal line in the chart, and pending or skipped states. It is also the
  light-mode focus ring (`--ring`): 4.73:1 on Paper and 4.34:1 on Paper Tint. The ring is each
  theme's secondary-text step, so a solid focus indicator clears 3:1 wherever a control sits.
- **Charcoal** (oklch(0.269 0 0)): dark-mode tints and badges.
- **Lead** (oklch(0.371 0 0)): the user's chat bubble in dark mode (`--bubble-user`), one step
  above the assistant's Charcoal (1.45:1 between them), with Bright Paper text at 9.9:1. It sits
  below Pencil, so in dark the brightest blocks on screen are the primary buttons, not a bubble.
- **Deep Ink** (oklch(0.145 0 0)): body text on Paper, and the dark-mode page.
- **Bright Paper** (oklch(0.985 0 0)): text on Ink, and dark-mode body text.

### Signals

- **Stop Red** (oklch(0.577 0.245 27.325); dark oklch(0.704 0.191 22.216)): failure. Error codes,
  failed stages and removed sections. On the error card it is tinted (a 40% border on Paper), so an
  error reads as information, not an alarm. Token: `--destructive`.
- **Go Green** (oklch(0.508 0.118 165.612); dark oklch(0.765 0.177 163.223)): success and
  completion. Succeeded stages and runs, added sections, "ok" tool states, and the 1.5s ring on a
  board card whose status just changed. Token: `--success` (`text-success`).
- **Trace Blue** (oklch(0.55 0.163 255.53), #2070ce; dark oklch(0.622 0.161 255.05), #3987e5): the
  measured data line. Used only for the "Remaining" series of the burndown chart and its end
  label, which is small text, so the light value holds 4.91:1 on Paper (dark 5.44:1). Token:
  `--chart-1`.

**Brand accent: open.** No brand colour exists today, and none is to be invented. A single brand
accent may be introduced later, by decision. Until then, hue on chrome is off-system.

### Named Rules

**The Signal-Only Rule.** Hue means something happened: success, failure, or measured data.
Chrome, layout and decoration stay on the ink-and-paper ramp.

**The Word-First Rule.** Every state is legible in greyscale. Colour sits on a label ("failed",
"awaiting approval"), an error code, or a stage glyph (○ ◐ ● ✕ –), never on its own.

## Typography

**Body Font:** Geist Variable (with sans-serif), self-hosted, weights 400 to 600.
**Label/Mono Font:** the platform monospace stack (`ui-monospace`).

**Character:** a single neutral grotesque that stays out of the way, with monospace as the
instrument readout: wherever something can be copied, matched or referenced, it is mono.

### Hierarchy

- **Headline** (600, 18px, 28px line): the sprint name. It is the only `h1` in the main view.
- **Stat** (500, 24px, 32px line, tabular figures): the four sprint numbers.
- **Title** (600, 14px, 20px line): the wordmark and pane headings ("Copilot").
- **Body** (400, 14px, 20px line): chat messages, issue titles (at 500), and the sprint goal.
- **Caption** (400, 12px, 16px line): chat card bodies, meta lines and assignees. Graphite when
  secondary.
- **Label** (500, 12px): badges, counts and statuses. Nothing in the system is uppercase or
  tracked, and no label sits above a heading: the heading carries its own weight.
- **Mono** (400, 12px): issue keys, tool names, versions, environments, stage names, error codes,
  log lines and inline code (at 0.85em). Also the state glyphs (○ ◐ ● ✕ –) wherever they appear,
  on the deployment card, the approval record and the theme toggle: Geist has none of them, and
  the fallback drew ● at half the height of ◐, while the mono stack draws the set at one size.
- **Chart Label** (400, 11px, tabular): the chart's axis values, dates, "today" and the line-end
  values, drawn at real size, the one size below Caption. The chart's viewBox follows the width it
  is drawn at, so an SVG unit is a CSS pixel and no label shrinks in a narrow column.

### Named Rules

**The Readout Rule.** If it is an identifier, it is monospace. If it is a number in a list or a
stat, it uses tabular figures.

## Layout

From the large breakpoint up, the app fills the viewport as a fixed grid: a header row above a
body that splits into a fluid workspace and a 360 to 440px chat column, with each pane scrolling on
its own. Below it the panes stack and the page scrolls: the board flows at its natural height, and
the copilot follows, divided by a hairline, with a full screen of its own.

- **Gutters:** 16px, and 24px from the large breakpoint, repeated on the header, chat header,
  message list, composer and workspace.
- **Rhythm:** a 4px base. Stacks inside cards use 4 to 8px gaps. Grids and chat messages use
  12px. Page sections use 16px.
- **Board and stats follow the pane, not the window.** The workspace is a size container. Below
  42rem of pane the board has 2 columns, from 42rem 3, and from 56rem all 5 statuses sit in one
  row. Stats go from 2 across to 4 at 42rem. Gaps are 12px, and the backlog sits below as its own
  grid. A full Done column can push the backlog out of view, so the rule between the stats and the
  board carries a ghost "Backlog 2 ↓" at its end, which moves focus to the backlog heading and so
  scrolls whichever container holds it (the pane from lg up, the page below). Each column's cards
  are a list (`ul role="list"`), and the count badges and points badges carry their unit for
  screen readers only ("2 issues", "5 points").
- **Chat:** the transcript is a `role="log"` named "Conversation" that does not speak itself
  (`aria-live="off"`), and each bubble is an `<article>` named for its speaker ("You" or
  "Copilot"). One always-mounted polite status line reports the turn instead of the stream: "The
  copilot is working on your request…", then "Copilot replied." or "2 changes need your
  approval.", and each recorded decision. A text-only bubble spans at most 85% of the column, so the two speakers stay distinct.
  An assistant bubble that holds cards spans the full column, because tables, charts and approval
  controls need the width. The user's bubble aligns to the end and the assistant's to the start.
- **First run:** the empty transcript is the product's help. One 14px Graphite line says what to
  ask, then a labelled group ("Suggested requests") of five suggestion chips, wrapping, and then
  12px Graphite lines: "Every visitor shares this board. It resets at 00:00 UTC.", then "Messages
  go to third-party AI providers (Groq, Google Gemini) and may be logged. Don’t enter personal
  information.", then "Any MCP client can work on it too:" with a ghost Copy beside it, then the public MCP endpoint on a
  line of its own, in mono and the text colour (the live address alone nearly fills the 440px
  column, so a Copy after it always wrapped onto a line by itself). Copy reads "Copied" for 2s;
  its accessible name stays "Copy MCP address", and the status line says "MCP address copied.",
  so it is said once. All of it goes with the first message. The endpoint comes from
  the build (`VITE_MCP_URL`), and the line is left out when a build has none. No label sits above
  any of it.

Viewport breakpoints are Tailwind's defaults; the workspace uses container sizes instead (42rem,
56rem).

## Elevation & Depth

The system is flat by default. Depth comes from two things only: **hairline rings** (1px at 10%
of the foreground colour, on board cards and stat cards) and **tonal steps** (a Paper chat
card inset in a Paper Tint bubble, or Ink cards on a Deep Ink page in dark mode). Nothing carries
a drop shadow at rest. Lift is allowed as a response to state (hover, focus, drag) in future
interactive surfaces, but today no component uses it.

The main depth-like effect in use is the focus ring. Buttons and inputs take a solid 1px border
in `--ring` (Graphite; Pencil in dark mode) with a 3px halo of it at 50%. The border carries the
3:1, since the halo alone is about 1.5:1. Disclosures (`<summary>`) and the focusable scroll
regions (the board pane, the chat scroller) have no border to recolour, so they take a solid 2px
`--ring` outline: offset 2px on disclosures, and drawn inside on scroll regions, where an outer
outline would be clipped. That rule lives once in `main.css`, not per component.

Two more rings belong to the board, both 1px and drawn inside the card's own edge, so a marked
card keeps its footprint and stacked cards never merge. A **dashed** `--ring` outline, in place of
the 10% hairline, marks an issue a pending approval would move or hand on, and a **solid** Go Green
(`--success`) ring marks, for 1.5s, an issue the last read of the board added, moved or handed on
(see Board cards).
Neither is solid Graphite, so neither reads as focus.

### Named Rules

**The Flat-at-Rest Rule.** At rest, a surface is separated by a ring or a tone, never by a shadow.
A shadow, if it ever appears, is a reaction to a pointer or keyboard state.

## Shapes

The radius comes from one `--radius` of 10px:

- **Chat cards:** 8px.
- **Buttons, inputs and chat bubbles:** 10px. Small in-card buttons use 8px.
- **Board and stat cards:** 14px.
- **Badges:** full pills.
- **Progress tracks and liveness dots:** fully round.

Inline code uses a 4px radius.

Borders are a single 1px Rule line. Card sub-sections split with a bottom rule, and table rows
with a bottom rule that the last row drops. There is no clipping, no angled geometry and no
decorative silhouette. Softness comes from the radius, not from ornament.

## Components

The feel is **soft and approachable, quiet until it matters**. Everything is small, ringed and
muted at rest. Emphasis (a filled button, a heavier weight, a signal hue) is spent only where a
decision or a result lives.

### Buttons

- **Shape:** gently rounded, 10px for the default 32px height and 8px for the 28px size used in
  cards and the header. The 28px size sets its text at 12px medium, the Label step (shadcn's
  0.8rem fell between two steps).
- **Primary:** an Ink fill with Bright Paper text, reserved for the single affirmative action in a
  region (Send, Approve), or for the safe default (Deny) when the affirmative cannot land. A
  message holding several open approval cards is one region: only the first undecided card's
  Approve is Ink, and the others decide in outline. While the group header offers "Approve all",
  that button is the region's Ink and every card decides in outline.
- **Outline:** a Rule border on Paper, for secondary or abortive actions (Reset board, Stop reply,
  Deny, Cancel deploy). The composer's Stop names what it stops ("Stop reply"), so it is not
  mistaken for a deployment card's Cancel.
- **Secondary / Ghost:** Paper Tint fill or transparent. They pair as a toggle, with
  `aria-pressed`: secondary when on and ghost when off (the Published / Draft switch). The fill
  alone is about 1.1:1 on Paper, so the pressed half also takes a 2px underline in its text
  colour (Ink; Bright Paper in dark mode), keyed to `aria-pressed`. Ghost is also the theme
  toggle.
- **Hover / Focus / Press:** the fill shifts toward Paper Tint (outline, ghost) or to 80% (primary).
  Focus shows a solid `--ring` border with a 3px halo of it at 50%, in both themes (the outline
  variant keeps the ring border in dark mode). A press nudges the button down 1px.

### Chips (Badges)

- **Style:** pills, 20px tall, 12px medium text.
- **Secondary:** a Paper Tint fill, for counts and statuses.
- **Outline:** a hairline, for points, tool names (mono) and change types.
- **State:** badges are static labels. Only the change-type sign inside a badge takes a signal hue.
- **Sections (release-notes diff):** a Graphite "Sections:" label, then one outline chip per
  changed section, a sign and the heading ("+ Added", "− Fixed", "~ Changed"). The sign takes the
  tone; the word ("removed") is in the chip's title and read to screen readers after the heading.

- **Suggestion chips:** the first-run requests. Outline pills, 28px tall, 12px medium text in the
  text colour, 8px apart and wrapping, so five fit in two rows at 390px. Each is labelled by its
  outcome in a few words ("Close out the sprint", "Mark DS-42 as done": what the visitor asks for,
  never the twist the copilot is about to find) and sends a demo scenario's verbatim prompt,
  which its title shows. They are buttons, not badges: the only pills that act. No more than six,
  and no Ink: they are suggestions, and the composer's Send keeps the region's one fill.

### Cards / Containers

- **Board cards:** 14px corners on Paper with a 1px ring at 10%, 12px padding, a mono key and an
  outline points badge on top, and the title in 14px medium. The assignee's @handle follows as a
  caption, in the backlog too, since an issue there can be handed on.
- **Empty column:** a compact slot one line tall under the heading, 14px corners and a 1px Rule
  border on Paper, with "No issues" in 12px Graphite (4.73:1) inside it. A slot, not a caption, so
  the column keeps a shape beside its neighbours and no text is left floating under a heading. It
  is solid, never dashed, since dashes mean a pending change, and it takes no Paper Tint fill, where
  Graphite text falls to 4.34:1.
- **Stat cards:** four tiles, Committed, Completed, Remaining and Days left, each a Graphite label
  over a 24px tabular value. Remaining carries the row's one signal as a 12px Graphite sub-line:
  the gap to the burndown's ideal line on the board's clock, in whole points ("13 pts behind
  ideal", "On track", "7 pts ahead of ideal"). It comes from the same shared function the chart's
  ideal line is drawn with, so the tile and the chart agree on any day. It stays on the ramp: the
  word says behind or ahead, and no hue does. Progress (Completed ÷ Committed) was dropped as a
  restatement; Days left is the wireframe's fourth number and what makes the gap plannable.
- **Board status:** beside the sprint's name, a secondary badge reads "Live board" while the board
  is the Worker's and "Offline" while it is the seed or the last read failed, so it reads as the
  connection, not as the sprint going live. A failed read after a good one keeps the board it had
  (a laptop waking reads before the network is back, and the seed would then disown open cards),
  and only the newest of two overlapping reads lands. A 12px Graphite `<time>` follows the badge
  whenever the board is a Worker read: "Updated just now", "Updated 2 min ago", refreshed every
  30s, with the exact time in its title, so "Offline · Updated 3 min ago" says how old it is. The board is re-read when a
  turn settles and when the reader returns to the tab (window focus, or the page turning visible),
  at most once every 5s and never while a turn streams, through the same read that marks a changed
  card. It does not poll. "Updated" says when this tab read the board, not when anyone changed it, so
  on a Worker read that differs from the seed one more 12px Graphite caption follows: "· 3 changes
  since the last reset", counting each issue that is new or whose status or assignee differs. It
  says nothing at zero or on the seed.
- **Pending move (board card):** while an approval card asks to change an issue's status, its
  board card swaps its hairline for a 1px dashed `--ring` outline drawn inside its edge (offset
  -1px), so it keeps its footprint and aligns with the column heading, and takes a 12px medium
  caption in the text colour naming the destination ("→ Done", from the shared status labels;
  screen readers hear "Awaiting approval to move to Done"). It is read from the chat's open
  `update_issue_status` cards, matching keys the way the api does (trimmed, any case), and it goes
  the moment the card is answered. New issues have no card to mark.
- **Pending reassignment (board card):** while an approval card asks to hand an issue to someone
  else, its board card takes the same dashed ring, and stays in its column, since only a status
  change says where a card would go. Under the current assignee, a 12px medium caption in the text
  colour names the new one ("→ @dana", or "→ Unassigned"; screen readers hear "Awaiting approval
  to assign to @dana" or "Awaiting approval to unassign"), so "@ben" then "→ @dana" reads as the
  hand-on. It is read from the chat's open `assign_issue` cards with the same key matching, and it
  goes the moment the card is answered.
- **Changed (board card):** when a read of the board finds an issue is new, or that its status or
  assignee changed, since the last read, the card is marked for 1.5s: a 1px solid Go Green (`--success`) ring inside its edge
  (offset -1px) holds, then fades on an exponential ease-out. It takes no background tint, since
  the card's muted text is 4.73:1 on Paper and any tint past about 2% drops it under 4.5:1. Under
  reduced motion the ring is simply there for the same 1.5s. The first read, which replaces the
  seed, marks nothing, and a read that changes nothing lets a running mark finish.
- **Chat cards:** a shared shell of 8px corners, a 1px Rule border on Paper, 8 by 12px padding and
  12px type, inset inside the Paper Tint assistant bubble. This covers the issue table, burndown,
  release-notes diff, deployment progress, approval and tool chip.
- **Error card:** the same shell on Paper with a 40% Stop Red border. On Paper its 12px code and
  tool name hold 4.76:1 and 4.73:1; on the bubble's Paper Tint they fell under 4.5:1. It leads with
  one line in the board's words, chosen per error code in the SPA and filled from the call's own
  arguments ("No issue DS-42 on the board."), never the api's model-facing message. The
  identifiers in it (the key, a sprint id, a version, an environment) are set in mono, as on the
  approval card's warning. The mono tool
  name and the Stop Red code follow as its label.
- **Issue table (search):** the last column is "Match", a word (Strong, Good, Weak) from the
  search score's own scale; the score itself is in the cell's title and read to screen readers.
- **Markdown tables** the copilot writes sit in the same shell on Paper, so their Graphite headers
  clear 4.5:1.
- **Shadow strategy:** none (see Elevation & Depth).

### Inputs / Fields

- **Style:** 32px tall, 10px corners, a 1px Rule stroke, transparent on Paper (the dark input
  colour at 30%, about 4.5% white, in dark mode), 14px text.
- **Focus:** a `--ring` border with a 3px `--ring` halo at 50%.
- **Error / Disabled:** a Stop Red border and a 20% ring when invalid. At 50% opacity with no
  pointer when disabled, except the composer, which is never disabled: while a turn runs it is
  read-only with `aria-disabled`, so it keeps the focus it holds, and it stays at full opacity.
  While approvals are open it stays editable, so the next message can be drafted, and only Send is
  disabled (Enter does nothing); the draft survives the turn the answers resume. Its placeholder
  names what to do in a form short enough to fit at 390px ("Decide on the change above", or
  "Decide on the 5 changes above"), and the full sentence ("Approve or deny the 5 changes above to
  continue.") is its `aria-describedby`, shown as a 12px Graphite line under the field once a
  draft hides the placeholder.
- **History:** Up in an empty composer recalls the session's earlier prompts, newest first, and
  Down walks forward to the empty field again, as in a shell. A typed draft is never replaced.
- **Size on phones:** every field, the approval card's reason input included, is 16px below the
  medium breakpoint, so iOS does not zoom on focus. The reason input drops to 12px from md.

### Navigation

There is a single header bar: the wordmark in 14px semibold on the left, and the Reset board
(outline) and theme toggle (ghost, glyphs ○ ● ◐ with an accessible label) on the right. It has a
hairline underneath and no fill. There are no routes to navigate besides a 404.

- **Copilot jump (below lg):** an outline "Copilot ↓" before Reset board. Stacked, the copilot
  starts under the whole board, so this scrolls to the chat pane (smoothly, or at once under
  reduced motion) and focuses the composer. It is hidden from lg up, where both panes share the
  view.
- **Reset board asks first, inline.** The board is shared, so the first click swaps the button for
  a named group: "Reset for everyone?" in 12px medium, an outline Confirm and a ghost Cancel, with
  focus moved to Confirm. Esc, Cancel, focus moving to another control or a press outside the group back
  out, and focus returns to Reset board when it was inside the question. It never times out: a
  screen reader can take seconds to read Confirm and its description, and a control that vanished
  under it would fail WCAG 2.2.1. Both Reset board and Confirm are described by "Restores the seed
  board for every visitor.", which is also Reset board's title, full stop included. While the reset runs the button reads
  "Resetting…" with `aria-disabled`, so it keeps the focus Confirm hands back. No modal: the
  question needs neither interruption nor protected focus.

### Approval Card (signature)

The record of a decision. It opens on a 14px medium headline (the one 14px line inside chat cards),
with no label above it: "Approval required" would be untrue on a decided card. Under it sit the
issue title and a quiet 12px Graphite mono line naming the tool, and the raw arguments are one
`<details>` away. What a write would store is on the card itself, not behind that disclosure, since
this card is the control against a prompt injection (ADR-0016): a new issue's assignee, priority,
points and labels in one 12px Graphite line under its title ("@dana · high · 3 pts · billing,
export"), and, above the disclosure, a new issue's description, the release notes it would save or
the comment on a move to blocked, which becomes the blocked reason. A move to any other status drops
its comment, so the card does not show it. That text sits in a 1px Rule box in 12px Graphite, up to
192px tall, with a tab stop because it scrolls. It is shown as plain text, never as markdown, and
all of it can be scrolled to, since a clamp would let injected text sit below the cut. So that
padding cannot do the same, the box drops blank lines at the top and closes up longer runs of them
to one, and the raw arguments keep the text as sent. When the text runs past the box, a 12px
Graphite line under it says "Scroll to read all of it.", since an overlay scrollbar shows nothing at
rest. A deployment that would skip
its tests says so in the headline ("Deploy v1.5.0 to production, tests skipped"), so the names
built on the headline and the decided record say it too. That is not a warning: a person may have
asked for it, so Approve keeps the Ink. While pending, it holds a reason input, an outline Deny and a primary Approve,
which is outline too on every open card but the first in its message. When a status change or
reassignment targets a key the board does not hold, or a reassignment names an id nobody on the team
has, a 12px Stop Red line says so under the headline ("DS-42 isn’t on the board.", "No one on the
team has the id u-zed.", identifiers in mono), the decision group is described by it, Deny takes the
Ink and Approve drops to outline. Approve still works, so the write can return its typed error. When
resolved, the controls give way to one line in Graphite, and in Stop Red only when an approved write
failed. It leads with a glyph from the deployment card's language (● applied, in Go Green; ◐ still
running; – denied or cancelled; ✕ failed), drawn in mono and hidden from screen readers, then the
words and the time of the decision on a 24-hour clock in the reader's locale: "● Approved by you at
14:02 — applied." or "– Denied by you at 14:03: “Still blocked”.". A typed error is explained by the
ErrorCard right below, code and all, so the line stays short and on one line: "✕ Approved by you at
14:02 — not applied.". The status line, which does not read the ErrorCard, adds the code: "… — not
applied (ISSUE_NOT_FOUND)." An `INTERNAL` error is not a refusal, since the write may have landed
with only its reply lost, so the line reads "✕ Approved by you at 14:02 — outcome unknown." and the
ErrorCard sends the person to the board before trying again. A status change keeps its "from" after
the decision ("DS-9: In progress → Done"): the board's status is captured with the time when the
person answers, since the board moves on once the write lands. A reassignment reads the same way, with people named by @handle and
nobody as "Unassigned" ("DS-12: Unassigned → @dana"), and keeps its "from" assignee by the same
capture.

Decisions are followed by focus and by voice. The pending controls are a named group ("Decision:
DS-7: In review → Done"). When a turn ends waiting on approvals, focus moves to the first open
card's group, or to the group header when it offers "Approve all", so that button is the next Tab.
It never lands on the button itself, where a stray Enter would approve the batch. After each Approve or Deny it moves to the next open card, and back to the composer
once none are left. Focus moves only when it was already in the chat pane or had fallen to the
page, so someone working on the board is not pulled away. The outcome line is also what the
transcript's status line announces.

**Group header.** A message with two or more approval cards in its current round, at least one still
open, gets one 12px medium line in the bubble's text colour above the round's first card (Graphite
would fall under 4.5:1 on the bubble's Paper Tint): "5 changes to review · 23 pts", counting the open
cards and the board points of the issues they would move (the points are left off when none are
known). A card that already ran belongs to an earlier round, since a continuation appends to the same
message, and stays above the header, so landing on the header shows the cards it offers. It is a
named group that takes focus by script, with the shared focus outline. It goes once every card is
decided. Each card keeps its own decision.

**Approve all.** When two or more of the open cards on the last message are board writes that can
land (a status change for a key the board holds, a new issue, or a reassignment of an issue the
board holds to someone on the team, or to nobody, who does not already have it), the header line
carries a small primary button at its end, "Approve all 5", or "Approve remaining 4" once some were
answered one by one. Its count is exactly what it answers, and it is the region's one Ink while
shown. Deploys, release notes, a key the board does not hold and a reassignment that cannot land are
never in it: a 12px line in the bubble's text colour under the header names them ("DS-42 needs its
own decision.", identifiers in mono). The press answers each card on its own, so each keeps its own
record line, time and "from". The status line says it once, when the last of them has turned ("4
changes approved by you at 14:05."), and focus moves to the next card it left, or the composer.

**Undo.** An applied status change, reassignment or new issue carries a ghost "Undo" (24px, never
Ink) after its record line; release notes and deployments have none. It sends only the workspace's
change id, so what goes back is the server's record, not the card's. Once undone, a second Graphite
line follows the record, led by a mono ↶ hidden from screen readers: "↶ Undone by you at 14:05 —
DS-9 back to In progress." (or "— DS-12 back to unassigned.", "— DS-7 back to @ben.", "— DS-14
removed from the board."), and the board re-reads, so a restored card takes its Go Green ring. A
refusal reads in Stop Red in the board's words ("That change to DS-9 can’t be undone: the board has
moved on."), and the Undo does not come back. Both are said on the status line, and focus lands on
the new line. A network failure toasts and keeps the Undo.

**No approve shortcut.** No key or chord approves a write. It was left out on purpose: Approve all
covers the batch, and a chord would make a gated decision easier to pass by accident.

### Deployment Progress (signature)

A version and an environment in mono, a stage list where each line carries a glyph (○ pending,
◐ running, ● succeeded, ✕ failed, – skipped) and its tone, a log tail, and a 4px round track
filled in the text colour (Deep Ink; Bright Paper in dark mode) by whole stages. Status is
announced politely to screen readers.

### Burndown Chart (signature)

An inline SVG figure titled with the sprint's name ("Burndown: Sprint 12 — Notifications &
billing"; the id, in mono, only for a sprint the board does not hold). "Remaining" is a 2px Trace
Blue line and "Ideal" a 2px dashed Graphite line, over Rule gridlines and 11px tabular labels,
drawn at real size: the viewBox takes the chart's drawn width, and the height stays 180px, so the
plot keeps its height in any column. Dates label the first and last day and every few days between,
centred on their day, as many as fit with a label's width and a 12px gap between them (every third
day in a phone column). The ideal value is given in whole points in the readout, the end label and
the Series table; the line is drawn from the exact values. The value axis steps from zero by one
round number (1, 2 or 5 times a power of ten, at most five lines), so 31 points read 0 / 10 / 20
/ 30, not thirds of 31 (0 / 10 / 21 / 31); the scale still runs to the maximum. Hovering moves the readout to the
hovered day.

## Do's and Don'ts

### Do:

- **Do** keep chrome on the ink-and-paper ramp, and reach for Go Green, Stop Red or Trace Blue only
  when a result or a measurement is being shown.
- **Do** pair every state with a word, code or glyph, so it reads in greyscale.
- **Do** set identifiers in monospace and numbers in tabular figures.
- **Do** separate surfaces with a 1px ring at 10% or a tonal step, and keep 14px corners for board
  cards and 8px for chat cards.
- **Do** keep the user's bubble on `--bubble-user`, not `--primary`, so dark mode does not light it
  up.
- **Do** spend the Ink-filled button once per region, on the affirmative action, or on the safe
  default (Deny) when the affirmative cannot land, and use outline for everything else. While a
  group header offers "Approve all", it is that region's Ink, and an Undo on a record is ghost.
- **Do** check every change in both themes at WCAG 2.2 AA.
- **Do** theme the browser's own surfaces: `color-scheme` per theme, an ink-tint selection, Rule-coloured
  scrollbars, a `theme-color` that follows the chosen theme (not only the OS), and the theme applied
  before first paint.

### Don't:

- **Don't** put a drop shadow on a surface at rest.
- **Don't** add hue for decoration or branding until a single brand accent has been chosen
  deliberately.
- **Don't** hard-code a colour. Every signal is a token (`--success`, `--destructive`,
  `--chart-1`), and a new colour arrives as a token in both themes or not at all.
- **Don't** wrap an OKLCH token in `hsl()`. Mix with `color-mix(in oklch, …)`.
- **Don't** add motion without a `prefers-reduced-motion` fallback. Pulses stop, the progress
  fill jumps (`motion-reduce:`) and a changed board card's ring holds still, and the state word
  or the static mark still carries the meaning.
- **Don't** put a label or eyebrow above a heading.
- **Don't** render model text as HTML or links. Chat text uses the safe subset only.
