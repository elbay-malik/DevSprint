<script setup lang="ts">
import { computed } from 'vue'
import type { IssueSummary, SearchIssuesMatch } from '@devsprint/shared/tools'
import { Badge } from '@/components/ui/badge'

/**
 * Issues as a table rather than raw JSON (docs/wireframes.md §5).
 *
 * `list_issues` and `search_issues` return different rows, so the compact
 * variant carries the match score and drops the columns a search result does
 * not have.
 */
const props = defineProps<{
  issues?: IssueSummary[]
  matches?: SearchIssuesMatch[]
}>()

const compact = computed(() => props.matches !== undefined)

const rows = computed(() =>
  compact.value
    ? (props.matches ?? []).map((match) => ({
        key: match.key,
        title: match.title,
        status: match.status,
        trailing: match.score.toFixed(2),
      }))
    : (props.issues ?? []).map((issue) => ({
        key: issue.key,
        title: issue.title,
        status: issue.status,
        trailing: `${issue.points}`,
      })),
)

const caption = computed(
  () => `${rows.value.length} ${rows.value.length === 1 ? 'issue' : 'issues'}`,
)

const STATUS_LABELS: Record<string, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  in_review: 'In review',
  blocked: 'Blocked',
  done: 'Done',
}
</script>

<template>
  <div data-testid="issue-table" class="bg-background min-w-0 rounded-md border text-xs">
    <p v-if="rows.length === 0" class="text-muted-foreground px-3 py-2">
      {{ compact ? 'No matching issues.' : 'No issues match that filter.' }}
    </p>
    <table v-else class="w-full">
      <caption class="text-muted-foreground px-3 pt-2 text-left">
        {{
          caption
        }}
      </caption>
      <thead class="text-muted-foreground">
        <tr class="border-b">
          <th scope="col" class="px-3 py-1.5 text-left font-normal">Issue</th>
          <th scope="col" class="px-3 py-1.5 text-left font-normal">Status</th>
          <th scope="col" class="px-3 py-1.5 text-right font-normal">
            {{ compact ? 'Score' : 'Pts' }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key" class="border-b last:border-0">
          <td class="min-w-0 px-3 py-1.5">
            <span class="text-muted-foreground font-mono">{{ row.key }}</span>
            <span class="ml-2">{{ row.title }}</span>
          </td>
          <td class="px-3 py-1.5">
            <Badge variant="secondary" class="font-normal">
              {{ STATUS_LABELS[row.status] ?? row.status }}
            </Badge>
          </td>
          <td class="px-3 py-1.5 text-right tabular-nums">{{ row.trailing }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
