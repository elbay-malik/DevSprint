<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BurndownData } from '@devsprint/shared/tools'

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

// Roughly 2:1 rather than 3:1 — in a ~360px chat column the wider box collapsed
// the plot to about 100px tall, which flattened the very gap the chart exists to
// show.
const WIDTH = 440
const HEIGHT = 210
const PAD = { top: 14, right: 42, bottom: 24, left: 32 }

const plotWidth = WIDTH - PAD.left - PAD.right
const plotHeight = HEIGHT - PAD.top - PAD.bottom

const days = computed(() => props.data.days)

/** Headroom so the top of the line is never flush with the frame. */
const maxY = computed(
  () => Math.max(props.data.committedPoints, ...days.value.map((d) => d.remaining)) || 1,
)

function x(index: number): number {
  const last = Math.max(days.value.length - 1, 1)
  return PAD.left + (index / last) * plotWidth
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

/** Four ticks is enough to read the scale without crowding a 180px plot. */
const yTicks = computed(() => {
  const step = maxY.value / 3
  return [0, step, step * 2, maxY.value].map((value) => ({ value: Math.round(value), y: y(value) }))
})

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
  const position = ratio * WIDTH
  const last = Math.max(days.value.length - 1, 1)
  const index = Math.round(((position - PAD.left) / plotWidth) * last)
  hovered.value = Math.min(Math.max(index, 0), days.value.length - 1)
}

/** Short label: the sprint never spans a year, so the month and day are enough. */
function shortDate(date: string): string {
  return date.slice(5).replace('-', '/')
}
</script>

<template>
  <figure data-testid="burndown-chart" class="bg-background m-0 rounded-md border p-3">
    <figcaption class="flex flex-wrap items-baseline justify-between gap-2">
      <span class="text-sm font-medium">Burndown — {{ data.sprintId }}</span>
      <span v-if="active" class="text-muted-foreground text-xs tabular-nums">
        {{ shortDate(active.date) }} · {{ active.remaining }} of {{ data.committedPoints }}
        {{ data.unit }} left · ideal {{ active.ideal }}
      </span>
    </figcaption>

    <!-- Identity never rests on colour alone: the key repeats the line style. -->
    <ul class="text-muted-foreground mt-1 flex gap-4 text-xs" aria-hidden="true">
      <li class="flex items-center gap-1.5">
        <svg width="16" height="8" viewBox="0 0 16 8" class="text-[#2a78d6] dark:text-[#3987e5]">
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
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      class="mt-1 w-full"
      role="img"
      :aria-label="`Burndown for ${data.sprintId}: ${active?.remaining ?? 0} of ${data.committedPoints} ${data.unit} remaining`"
    >
      <!-- Recessive frame: hairline, solid, one step off the surface. -->
      <g class="text-border" stroke="currentColor" stroke-width="1">
        <line
          v-for="tick in yTicks"
          :key="tick.value"
          :x1="PAD.left"
          :y1="tick.y"
          :x2="WIDTH - PAD.right"
          :y2="tick.y"
        />
      </g>
      <g class="fill-muted-foreground text-[10px] tabular-nums">
        <text
          v-for="tick in yTicks"
          :key="tick.value"
          :x="PAD.left - 6"
          :y="tick.y + 3"
          text-anchor="end"
        >
          {{ tick.value }}
        </text>
        <text :x="PAD.left" :y="HEIGHT - 6">{{ shortDate(days[0]?.date ?? '') }}</text>
        <text :x="WIDTH - PAD.right" :y="HEIGHT - 6" text-anchor="end">
          {{ shortDate(days.at(-1)?.date ?? '') }}
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
        <text :x="x(todayIndex) + 4" :y="PAD.top + 8" class="fill-muted-foreground text-[10px]">
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
        class="text-[#2a78d6] dark:text-[#3987e5]"
      />

      <!-- Values at the line ends rather than a number on every point. -->
      <g class="text-[10px] tabular-nums">
        <text
          :x="WIDTH - PAD.right + 6"
          :y="y(days.at(-1)?.remaining ?? 0) + 3"
          class="fill-[#2a78d6] dark:fill-[#3987e5]"
        >
          {{ days.at(-1)?.remaining ?? 0 }}
        </text>
        <text
          :x="WIDTH - PAD.right + 6"
          :y="y(days.at(-1)?.ideal ?? 0) + 3"
          class="fill-muted-foreground"
        >
          {{ days.at(-1)?.ideal ?? 0 }}
        </text>
      </g>

      <!-- A ring in the surface colour keeps the dot legible where the lines cross. -->
      <circle
        v-if="active && activeIndex !== undefined"
        :cx="x(activeIndex)"
        :cy="y(active.remaining)"
        r="4"
        class="fill-[#2a78d6] stroke-background dark:fill-[#3987e5]"
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
      <summary class="text-muted-foreground cursor-pointer text-xs select-none">Series</summary>
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
            <td>{{ day.ideal }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>
