<script setup lang="ts">
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { paceLabel, type SprintStats } from '../lib/sprint-stats'

const props = defineProps<{ stats: SprintStats }>()

/**
 * Remaining carries the one signal the row exists for, how far the board is
 * from the burndown's ideal line. The fourth tile was Progress, which only
 * restated Completed ÷ Committed; Days left (the wireframe's "4d left") is
 * what turns "13 pts behind" into something a lead can plan against.
 */
const cards = [
  { label: 'Committed', value: () => `${props.stats.committedPoints} pts` },
  { label: 'Completed', value: () => `${props.stats.completedPoints} pts` },
  {
    label: 'Remaining',
    value: () => `${props.stats.remainingPoints} pts`,
    detail: () => (props.stats.pace ? paceLabel(props.stats.pace) : undefined),
  },
  {
    label: 'Days left',
    value: () =>
      props.stats.daysLeft === null
        ? '–'
        : `${props.stats.daysLeft} ${props.stats.daysLeft === 1 ? 'day' : 'days'}`,
  },
]
</script>

<template>
  <div class="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
    <Card
      v-for="card in cards"
      :key="card.label"
      data-testid="sprint-stat"
      :data-stat="card.label"
      class="gap-1 py-4"
    >
      <CardContent class="px-4">
        <CardDescription>{{ card.label }}</CardDescription>
        <CardTitle class="text-2xl tabular-nums">{{ card.value() }}</CardTitle>
        <p
          v-if="card.detail?.()"
          data-testid="stat-pace"
          class="text-muted-foreground text-xs tabular-nums"
        >
          {{ card.detail() }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>
