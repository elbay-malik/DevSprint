<script setup lang="ts">
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import type { SprintStats } from '../lib/sprint-stats'

const props = defineProps<{ stats: SprintStats }>()

const cards = [
  { label: 'Committed', value: () => `${props.stats.committedPoints} pts` },
  { label: 'Completed', value: () => `${props.stats.completedPoints} pts` },
  { label: 'Remaining', value: () => `${props.stats.remainingPoints} pts` },
  { label: 'Progress', value: () => `${props.stats.completionPct}%` },
]
</script>

<template>
  <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
    <Card v-for="card in cards" :key="card.label" class="gap-1 py-4">
      <CardContent class="px-4">
        <CardDescription>{{ card.label }}</CardDescription>
        <CardTitle class="text-2xl tabular-nums">{{ card.value() }}</CardTitle>
      </CardContent>
    </Card>
  </div>
</template>
