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
  roles invert: the primary fill becomes Rule (oklch(0.922 0 0)) with Ink text.

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
  log lines and inline code (at 0.85em).
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
the 10% hairline, marks an issue a pending approval would move, and a **solid** Go Green
(`--success`) ring marks, for 1.5s, an issue the last read of the board moved (see Board cards).
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
  cards and the header.
- **Primary:** an Ink fill with Bright Paper text, reserved for the single affirmative action in a
  region (Send, Approve), or for the safe default (Deny) when the affirmative cannot land. A
  message holding several open approval cards is one region: only the first undecided card's
  Approve is Ink, and the others decide in outline.
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

### Cards / Containers

- **Board cards:** 14px corners on Paper with a 1px ring at 10%, 12px padding, a mono key and an
  outline points badge on top, and the title in 14px medium.
- **Empty column:** a compact slot one line tall under the heading, 14px corners and a 1px Rule
  border on Paper, with "No issues" in 12px Graphite (4.73:1) inside it. A slot, not a caption, so
  the column keeps a shape beside its neighbours and no text is left floating under a heading. It
  is solid, never dashed, since dashes mean a pending move, and it takes no Paper Tint fill, where
  Graphite text falls to 4.34:1.
- **Stat cards:** four tiles, Committed, Completed, Remaining and Days left, each a Graphite label
  over a 24px tabular value. Remaining carries the row's one signal as a 12px Graphite sub-line:
  the gap to the burndown's ideal line on the board's clock, in whole points ("13 pts behind
  ideal", "On track", "7 pts ahead of ideal"). It comes from the same shared function the chart's
  ideal line is drawn with, so the tile and the chart agree on any day. It stays on the ramp: the
  word says behind or ahead, and no hue does. Progress (Completed ÷ Committed) was dropped as a
  restatement; Days left is the wireframe's fourth number and what makes the gap plannable.
- **Board status:** beside the sprint's name, a secondary badge reads "Live board" while the board
  is the Worker's and "Offline" while it is the seed, so it reads as the connection, not as the
  sprint going live. A 12px Graphite `<time>` follows it while live: "Updated just now", "Updated
  2 min ago", refreshed every 30s, with the exact time in its title. The board is re-read when a
  turn settles and when the reader returns to the tab (window focus, or the page turning visible),
  at most once every 5s and never while a turn streams, through the same read that marks a changed
  card. It does not poll.
- **Pending move (board card):** while an approval card asks to change an issue's status, its
  board card swaps its hairline for a 1px dashed `--ring` outline drawn inside its edge (offset
  -1px), so it keeps its footprint and aligns with the column heading, and takes a 12px medium
  caption in the text colour naming the destination ("→ Done", from the shared status labels;
  screen readers hear "Awaiting approval to move to Done"). It is read from the chat's open
  `update_issue_status` cards, matching keys the way the api does (trimmed, any case), and it goes
  the moment the card is answered. New issues have no card to mark.
- **Changed (board card):** when a read of the board finds an issue's status changed since the
  last read, the card is marked for 1.5s: a 1px solid Go Green (`--success`) ring inside its edge
  (offset -1px) holds, then fades on an exponential ease-out. It takes no background tint, since
  the card's muted text is 4.73:1 on Paper and any tint past about 2% drops it under 4.5:1. Under
  reduced motion the ring is simply there for the same 1.5s. The first read, which replaces the
  seed, marks nothing, and a read that moves nothing lets a running mark finish.
- **Chat cards:** a shared shell of 8px corners, a 1px Rule border on Paper, 8 by 12px padding and
  12px type, inset inside the Paper Tint assistant bubble. This covers the issue table, burndown,
  release-notes diff, deployment progress, approval and tool chip.
- **Error card:** the same shell on Paper with a 40% Stop Red border. On Paper its 12px code and
  tool name hold 4.76:1 and 4.73:1; on the bubble's Paper Tint they fell under 4.5:1. It leads with
  one line in the board's words, chosen per error code in the SPA and filled from the call's own
  arguments ("No issue DS-42 on the board."), never the api's model-facing message. The mono tool
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
  pointer when disabled, except the composer, which is never disabled: while a turn runs or
  approvals are open it is read-only with `aria-disabled`, so it keeps the focus it holds, and it
  stays at full opacity. While locked, its placeholder names what to do in a form short enough to
  fit at 390px ("Decide on the change above", or "Decide on the 5 changes above"), and the full
  sentence ("Approve or deny the 5 changes above to continue.") is exposed to screen readers via
  `aria-describedby`.
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
  focus moved to Confirm. Esc, Cancel, focus moving to another control, a press outside the group
  or 4s without an answer back out, and focus returns to Reset board when it was inside the
  question. Both Reset board and Confirm are described by "Restores the seed board for every
  visitor.", which is also Reset board's title. While the reset runs the button reads
  "Resetting…" with `aria-disabled`, so it keeps the focus Confirm hands back. No modal: the
  question needs neither interruption nor protected focus.

### Approval Card (signature)

The record of a decision. It opens on a 14px medium headline (the one 14px line inside chat
cards), with no label above it: "Approval required" would be untrue on a decided card. Under it
sit the issue title and a quiet 12px Graphite mono line naming the tool, and the raw arguments are
one `<details>` away. While pending, it holds a reason input, an outline Deny and a
primary Approve, which is outline too on every open card but the first in its message. When a
status change targets a key the board does not hold, a 12px Stop Red line says so under the
headline ("DS-42 isn’t on the board.", the key in mono), the decision group is described by it,
Deny takes the Ink and Approve drops to outline. Approve still works, so the write can return its
typed error. When resolved, the controls give way to one line in Graphite, and in Stop Red only
when an approved write failed. It leads with a glyph from the deployment card's language (● applied,
in Go Green; ◐ still running; – denied or cancelled; ✕ failed), drawn and hidden from screen
readers, then the words and the time of the decision on a 24-hour clock in the reader's locale:
"● Approved by you at 14:02 — applied." or "– Denied by you at 14:03: “Still blocked”.". A typed
error is explained by the ErrorCard right below, so the line stays short: "✕ Approved by you at
14:02 — not applied (ISSUE_NOT_FOUND).". A status change keeps its "from" after the decision
("DS-9: In progress → Done"): the board's status is captured with the time when the person
answers, since the board moves on once the write lands.

Decisions are followed by focus and by voice. The pending controls are a named group ("Decision:
DS-7: In review → Done"). When a turn ends waiting on approvals, focus moves to the first open
card's group. After each Approve or Deny it moves to the next open card, and back to the composer
once none are left. Focus moves only when it was already in the chat pane or had fallen to the
page, so someone working on the board is not pulled away. The outcome line is also what the
transcript's status line announces.

**Group header.** A message with two or more approval cards, at least one still open, gets one
12px medium line in the bubble's text colour above the first card (Graphite would fall under
4.5:1 on the bubble's Paper Tint): "5 changes to review · 23 pts", counting the open
cards and the board points of the issues they would move (the points are left off when none are
known). It goes once every card is decided. Each card keeps its own decision.

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
the Series table; the line is drawn from the exact values. Hovering moves the readout to the
hovered day.

## Do's and Don'ts

### Do:

- **Do** keep chrome on the ink-and-paper ramp, and reach for Go Green, Stop Red or Trace Blue only
  when a result or a measurement is being shown.
- **Do** pair every state with a word, code or glyph, so it reads in greyscale.
- **Do** set identifiers in monospace and numbers in tabular figures.
- **Do** separate surfaces with a 1px ring at 10% or a tonal step, and keep 14px corners for board
  cards and 8px for chat cards.
- **Do** spend the Ink-filled button once per region, on the affirmative action, or on the safe
  default (Deny) when the affirmative cannot land, and use outline for everything else.
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
