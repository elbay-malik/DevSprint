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
  trace-blue: '#2a78d6'
  trace-blue-dark: '#3987e5'
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

- **Ink** (oklch(0.205 0 0)): the one affirmative action per region (Send, Approve) and the user's
  own chat bubble. In dark mode the roles invert: the primary fill becomes Rule (oklch(0.922 0 0))
  with Ink text.

### Neutral

- **Paper** (oklch(1 0 0)): the page, board cards, and the inset surface of every chat card. In
  dark mode, Deep Ink is the page and Ink the cards.
- **Paper Tint** (oklch(0.97 0 0)): assistant bubbles, secondary badges, the progress track,
  hover fills. In dark mode, Charcoal.
- **Rule** (oklch(0.922 0 0)): every border, divider and input stroke. In dark mode, Paper at 10%
  for borders and 15% for inputs.
- **Pencil** (oklch(0.708 0 0)): the focus ring source, used at 50%. In dark mode it becomes the
  secondary text colour, and Graphite takes over the focus ring.
- **Graphite** (oklch(0.556 0 0)): secondary text everywhere, meaning captions, labels, keys,
  column headings, the ideal line in the chart, and pending or skipped states.
- **Charcoal** (oklch(0.269 0 0)): dark-mode tints and badges.
- **Deep Ink** (oklch(0.145 0 0)): body text on Paper, and the dark-mode page.
- **Bright Paper** (oklch(0.985 0 0)): text on Ink, and dark-mode body text.

### Signals

- **Stop Red** (oklch(0.577 0.245 27.325); dark oklch(0.704 0.191 22.216)): failure. Error codes,
  failed stages and removed sections. On the error card it is tinted (a 40% border on a 40% Paper
  Tint fill), so an error reads as information, not an alarm. Token: `--destructive`.
- **Go Green** (oklch(0.508 0.118 165.612); dark oklch(0.765 0.177 163.223)): success and
  completion. Succeeded stages and runs, added sections, and "ok" tool states. Token: `--success`
  (`text-success`).
- **Trace Blue** (#2a78d6; dark #3987e5): the measured data line. Used only for the "Remaining"
  series of the burndown chart. Token: `--chart-1`.

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
- Chart axis labels are 10px tabular, the one size below Caption.

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
  grid.
- **Chat:** a text-only bubble spans at most 85% of the column, so the two speakers stay distinct.
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

The only depth-like effect in use is the focus ring: 3px of Pencil at 50% (Graphite in dark
mode), or inset on the scrolling board pane.

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
  region (Send, Approve).
- **Outline:** a Rule border on Paper, for secondary or abortive actions (Reset board, Stop, Deny,
  Cancel deploy).
- **Secondary / Ghost:** Paper Tint fill or transparent. They pair as a toggle, with
  `aria-pressed`: secondary when on and ghost when off (the Published / Draft switch). Ghost is
  also the theme toggle.
- **Hover / Focus / Press:** the fill shifts toward Paper Tint (outline, ghost) or to 80% (primary).
  Focus shows a 3px Pencil ring at 50% with a Pencil border. A press nudges the button down 1px.

### Chips (Badges)

- **Style:** pills, 20px tall, 12px medium text.
- **Secondary:** a Paper Tint fill, for counts and statuses.
- **Outline:** a hairline, for points, tool names (mono) and change types.
- **State:** badges are static labels. Only the change-type word inside a badge takes a signal hue.

### Cards / Containers

- **Board cards:** 14px corners on Paper with a 1px ring at 10%, 12px padding, a mono key and an
  outline points badge on top, and the title in 14px medium.
- **Chat cards:** a shared shell of 8px corners, a 1px Rule border on Paper, 8 by 12px padding and
  12px type, inset inside the Paper Tint assistant bubble. This covers the issue table, burndown,
  release-notes diff, deployment progress, approval and tool chip.
- **Error card:** the same shell on a 40% Paper Tint fill with a 40% Stop Red border.
- **Shadow strategy:** none (see Elevation & Depth).

### Inputs / Fields

- **Style:** 32px tall, 10px corners, a 1px Rule stroke, transparent on Paper (the dark input
  colour at 30%, about 4.5% white, in dark mode), 14px text.
- **Focus:** a Pencil border with a 3px Pencil ring at 50%.
- **Error / Disabled:** a Stop Red border and a 20% ring when invalid. At 50% opacity with no
  pointer when disabled, except the composer: while it is locked it stays at full opacity, and its
  placeholder names what to do ("Approve or deny the change above to continue…", counting the
  changes when several are pending), also exposed to screen readers via `aria-describedby`.

### Navigation

There is a single header bar: the wordmark in 14px semibold on the left, and the Reset board
(outline) and theme toggle (ghost, glyphs ○ ● ◐ with an accessible label) on the right. It has a
hairline underneath and no fill. There are no routes to navigate besides a 404.

### Approval Card (signature)

The record of a decision. The eyebrow is 12px Graphite ("Approval required:" plus the mono tool
name), followed by a 14px medium headline (the one 14px line inside chat cards), and the raw
arguments one `<details>` away. While pending, it holds a reason input, an outline Deny and a
primary Approve. When resolved, the controls give way to one line, "Approved by you — applied."
or "Denied: …", in Graphite, and in Stop Red only when an approved write failed.

### Deployment Progress (signature)

A version and an environment in mono, a stage list where each line carries a glyph (○ pending,
◐ running, ● succeeded, ✕ failed, – skipped) and its tone, a log tail, and a 4px round track
filled in the text colour (Deep Ink; Bright Paper in dark mode) by whole stages. Status is
announced politely to screen readers.

### Burndown Chart (signature)

An inline SVG figure. "Remaining" is a 2px Trace Blue line and "Ideal" a 2px dashed Graphite line,
over Rule gridlines and 10px tabular axis labels. Hovering moves the readout to the hovered day.

## Do's and Don'ts

### Do:

- **Do** keep chrome on the ink-and-paper ramp, and reach for Go Green, Stop Red or Trace Blue only
  when a result or a measurement is being shown.
- **Do** pair every state with a word, code or glyph, so it reads in greyscale.
- **Do** set identifiers in monospace and numbers in tabular figures.
- **Do** separate surfaces with a 1px ring at 10% or a tonal step, and keep 14px corners for board
  cards and 8px for chat cards.
- **Do** spend the Ink-filled button once per region, on the affirmative action, and use outline
  for everything secondary or abortive.
- **Do** check every change in both themes at WCAG 2.2 AA.
- **Do** theme the browser's own surfaces: `color-scheme` per theme, an ink-tint selection, Rule-coloured
  scrollbars, and the theme applied before first paint.

### Don't:

- **Don't** put a drop shadow on a surface at rest.
- **Don't** add hue for decoration or branding until a single brand accent has been chosen
  deliberately.
- **Don't** hard-code a colour. Every signal is a token (`--success`, `--destructive`,
  `--chart-1`), and a new colour arrives as a token in both themes or not at all.
- **Don't** wrap an OKLCH token in `hsl()`. Mix with `color-mix(in oklch, …)`.
- **Don't** add motion without a `prefers-reduced-motion` fallback. Pulses stop and the progress
  fill jumps (`motion-reduce:`), and the state word still carries the meaning.
- **Don't** put a label or eyebrow above a heading.
- **Don't** render model text as HTML or links. Chat text uses the safe subset only.
