<script setup lang="ts">
import { computed, ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import type { BurndownData } from '@devsprint/shared/tools'
import { useWorkspaceStore } from '@/stores/workspace'
import { dateTickIndices } from '../lib/date-ticks'
import { valueTicks } from '../lib/value-ticks'

/**
 * Remaining work against the ideal line, drawn as inline SVG.
 *
 * `remaining` is the measurement and carries the one categorical hue;
 * `ideal` is a reference, so it stays in muted ink and dashed. Giving the
 * target an equal hue would read as two competing measurements. Line style
 * doubles as the non-colour encoding, so the two are still separable in
 * greyscale or with a colour vision deficiency.
 */
const props = defineProps<{ data: BurndownData }>()

const workspace = useWorkspaceStore()

/**
 * The sprint as the board names it ("Sprint 12 — Notifications & billing"),
 * not the tool's id. A sprint the board does not hold keeps its id, in mono.
 */
const sprintName = computed(
  () => workspace.workspace.sprints.find((sprint) => sprint.id === props.data.sprintId)?.name,
)
const sprintLabel = computed(() => sprintName.value ?? props.data.sprintId)

/**
 * The ideal line is linear, so most days land between whole points (9.54).
 * Labels and the table give whole points, which is what a sprint is counted
 * in; the line itself is drawn from the exact values.
 */
function points(value: number): number {
  return Math.round(value)
}

/**
 * One SVG unit is one CSS pixel. A fixed 440-wide viewBox scaled into a ~344px
 * column shrank the 10px labels to under 8px, so the viewBox takes the width the
 * chart is actually drawn at, and the height stays put: the plot keeps the same
 * 142px of height in every column instead of flattening as the column narrows.
 * WIDTH is only the first-paint guess, before the chart has been measured.
 */
const WIDTH = 440
const HEIGHT = 180
const PAD = { top: 14, right: 42, bottom: 24, left: 32 }
/** Below this the plot would invert; a chart that narrow is not being read. */
const MIN_WIDTH = 160

const svg = ref<SVGSVGElement>()
const width = ref(WIDTH)

useResizeObserver(svg, (entries) => {
  const measured = Math.round(entries[0]?.contentRect.width ?? 0)
  // A collapsed or hidden chart measures 0; keep the last real width.
  if (measured > 0) width.value = Math.max(measured, MIN_WIDTH)
})

const plotWidth = computed(() => width.value - PAD.left - PAD.right)
const plotHeight = HEIGHT - PAD.top - PAD.bottom

const days = computed(() => props.data.days)

/** Headroom so the top of the line is never flush with the frame. */
const maxY = computed(
  () => Math.max(props.data.committedPoints, ...days.value.map((d) => d.remaining)) || 1,
)

function x(index: number): number {
  const last = Math.max(days.value.length - 1, 1)
  return PAD.left + (index / last) * plotWidth.value
}

function y(value: number): number {
  return PAD.top + plotHeight - (value / maxY.value) * plotHeight
}

function path(pick: (day: BurndownData['days'][number]) => number): string {
  return days.value
    .map((day, index) => `${index === 0 ? 'M' : 'L'}${x(index)} ${y(pick(day))}`)
    .join(' ')
}

const remainingPath = computed(() => path((day) => day.remaining))
const idealPath = computed(() => path((day) => day.ideal))

/**
 * Round steps from zero (0 / 10 / 20 / 30 for the seeded sprint), so the axis
 * can be counted; the scale still runs to the maximum. Values are whole and
 * distinct, so each is its own key.
 */
const yTicks = computed(() =>
  valueTicks(maxY.value).map((value) => ({ key: value, label: value, y: y(value) })),
)

/** Dates under the plot, as many as fit without touching at the drawn width. */
const dateTicks = computed(() => dateTickIndices(days.value.length, plotWidth.value))

const asOfDate = computed(() => props.data.asOf.slice(0, 10))

/** The sprint is partly in the future, so the line is only real up to here. */
const todayIndex = computed(() => {
  for (let index = days.value.length - 1; index >= 0; index -= 1) {
    if ((days.value[index]?.date ?? '') <= asOfDate.value) return index
  }
  return undefined
})

const today = computed(() =>
  todayIndex.value === undefined ? undefined : days.value[todayIndex.value],
)

const hovered = ref<number | undefined>(undefined)
const active = computed(() =>
  hovered.value === undefined ? today.value : days.value[hovered.value],
)
const activeIndex = computed(() => hovered.value ?? todayIndex.value)

function onMove(event: PointerEvent) {
  const target = event.currentTarget as SVGRectElement
  const bounds = target.getBoundingClientRect()
  const ratio = (event.clientX - bounds.left) / bounds.width
  const position = ratio * width.value
  const last = Math.max(days.value.length - 1, 1)
  const index = Math.round(((position - PAD.left) / plotWidth.value) * last)
  hovered.value = Math.min(Math.max(index, 0), days.value.length - 1)
}

/** Short label: the sprint never spans a year, so the month and day are enough. */
function shortDate(date: string): string {
  return date.slice(5).replace('-', '/')
}
</script>

<template>
  <figure data-testid="burndown-chart" class="bg-background m-0 rounded-md border px-3 py-2">
    <figcaption class="flex flex-wrap items-baseline justify-between gap-2">
      <span data-testid="burndown-title" class="font-medium"
        >Burndown:
        <span :class="sprintName === undefined ? 'font-mono' : undefined">{{
          sprintLabel
        }}</span></span
      >
      <span v-if="active" class="text-muted-foreground text-xs tabular-nums">
        {{ shortDate(active.date) }} · {{ active.remaining }} of {{ data.committedPoints }}
        {{ data.unit }} left · ideal {{ points(active.ideal) }}
      </span>
    </figcaption>

    <!-- Identity never rests on colour alone: the key repeats the line style. -->
    <ul class="text-muted-foreground mt-1 flex gap-4 text-xs" aria-hidden="true">
      <li class="flex items-center gap-1.5">
        <svg width="16" height="8" viewBox="0 0 16 8" class="text-chart-1">
          <line x1="0" y1="4" x2="16" y2="4" stroke="currentColor" stroke-width="2" />
        </svg>
        Remaining
      </li>
      <li class="flex items-center gap-1.5">
        <svg width="16" height="8" viewBox="0 0 16 8">
          <line
            x1="0"
            y1="4"
            x2="16"
            y2="4"
            stroke="currentColor"
            stroke-width="2"
            stroke-dasharray="4 3"
          />
        </svg>
        Ideal
      </li>
    </ul>

    <svg
      ref="svg"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      class="mt-1 w-full"
      role="img"
      :aria-label="`Burndown for ${sprintLabel}: ${active?.remaining ?? 0} of ${data.committedPoints} ${data.unit} remaining`"
    >
      <!-- Recessive frame: hairline, solid, one step off the surface. -->
      <g class="text-border" stroke="currentColor" stroke-width="1">
        <line
          v-for="tick in yTicks"
          :key="tick.key"
          :x1="PAD.left"
          :y1="tick.y"
          :x2="width - PAD.right"
          :y2="tick.y"
        />
      </g>
      <g class="fill-muted-foreground text-[11px] tabular-nums">
        <text
          v-for="tick in yTicks"
          :key="tick.key"
          :x="PAD.left - 6"
          :y="tick.y + 4"
          text-anchor="end"
        >
          {{ tick.label }}
        </text>
        <text
          v-for="index in dateTicks"
          :key="`date-${index}`"
          data-testid="burndown-date"
          :x="x(index)"
          :y="HEIGHT - 6"
          text-anchor="middle"
        >
          {{ shortDate(days[index]?.date ?? '') }}
        </text>
      </g>

      <!-- The demo clock, so "behind" is legible as a position, not just a number. -->
      <g v-if="todayIndex !== undefined" class="text-muted-foreground">
        <line
          :x1="x(todayIndex)"
          :y1="PAD.top"
          :x2="x(todayIndex)"
          :y2="PAD.top + plotHeight"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="2 3"
        />
        <text :x="x(todayIndex) + 4" :y="PAD.top + 9" class="fill-muted-foreground text-[11px]">
          today
        </text>
      </g>

      <path
        :d="idealPath"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-dasharray="5 4"
        stroke-linecap="round"
        class="text-muted-foreground"
      />
      <path
        :d="remainingPath"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
        class="text-chart-1"
      />

      <!-- Values at the line ends rather than a number on every point. -->
      <g class="text-[11px] tabular-nums">
        <text
          :x="width - PAD.right + 6"
          :y="y(days.at(-1)?.remaining ?? 0) + 4"
          class="fill-chart-1"
        >
          {{ days.at(-1)?.remaining ?? 0 }}
        </text>
        <text
          :x="width - PAD.right + 6"
          :y="y(days.at(-1)?.ideal ?? 0) + 4"
          class="fill-muted-foreground"
        >
          {{ points(days.at(-1)?.ideal ?? 0) }}
        </text>
      </g>

      <!-- A ring in the surface colour keeps the dot legible where the lines cross. -->
      <circle
        v-if="active && activeIndex !== undefined"
        :cx="x(activeIndex)"
        :cy="y(active.remaining)"
        r="4"
        class="fill-chart-1 stroke-background"
        stroke-width="2"
      />

      <rect
        :x="PAD.left"
        :y="PAD.top"
        :width="plotWidth"
        :height="plotHeight"
        fill="transparent"
        @pointermove="onMove"
        @pointerleave="hovered = undefined"
      />
    </svg>

    <details class="mt-1">
      <summary
        class="text-muted-foreground hover:text-foreground cursor-pointer rounded-sm text-xs select-none"
      >
        Series
      </summary>
      <table class="mt-1 w-full text-xs tabular-nums">
        <thead class="text-muted-foreground text-left">
          <tr>
            <th scope="col" class="font-normal">Day</th>
            <th scope="col" class="font-normal">Remaining</th>
            <th scope="col" class="font-normal">Ideal</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in days" :key="day.date">
            <td>{{ day.date }}</td>
            <td>{{ day.remaining }}</td>
            <td>{{ points(day.ideal) }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>
