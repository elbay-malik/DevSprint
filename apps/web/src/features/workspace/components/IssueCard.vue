<script setup lang="ts">
import type { Issue } from '@devsprint/shared'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

defineProps<{
  issue: Issue
  assigneeHandle?: string
  /** Shown only where the column does not already say it — the backlog. */
  statusLabel?: string
}>()
</script>

<template>
  <Card data-testid="issue-card" :data-issue-key="issue.key" class="gap-0 py-3">
    <CardContent class="flex flex-col gap-1.5 px-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-muted-foreground font-mono text-xs">{{ issue.key }}</span>
        <Badge variant="outline" class="tabular-nums">{{ issue.points }}</Badge>
      </div>
      <p class="text-sm leading-snug font-medium">{{ issue.title }}</p>
      <p v-if="assigneeHandle" class="text-muted-foreground text-xs">{{ assigneeHandle }}</p>
      <p v-if="statusLabel" data-testid="issue-status" class="text-muted-foreground text-xs">
        {{ statusLabel }}
      </p>
    </CardContent>
  </Card>
</template>
