<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Deployment, StageStatus } from '@devsprint/shared'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { deploymentCancelEndpoint } from '@/lib/api'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * A deployment as it runs (docs/wireframes.md §5). The tool yields a whole
 * deployment on every step, so this draws itself from the same shape whether the
 * run is in flight or settled.
 *
 * Cancel posts to the api rather than aborting the turn; see `cancel()` below.
 */
const props = defineProps<{ deployment: Deployment; live?: boolean }>()

const workspace = useWorkspaceStore()

/**
 * A settled run is read back from the board rather than from the message.
 *
 * Tool output is frozen into the transcript, so a card scrolled back to weeks
 * later would otherwise still be replaying whatever the stream last said. The
 * board is the live record, so once the turn is over it wins — which is also
 * what keeps the card and the Deploys view agreeing (scenario S-C, C2).
 */
const shown = computed(() => {
  if (props.live === true) return props.deployment
  const stored = workspace.workspace.deployments.find(
    (candidate) => candidate.id === props.deployment.id,
  )
  return stored ?? props.deployment
})

const STAGE_TONES: Record<StageStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-foreground',
  succeeded: 'text-success',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground',
}

/** A glyph as well as a colour, so state survives greyscale. */
const STAGE_MARKS: Record<StageStatus, string> = {
  pending: '○',
  running: '◐',
  succeeded: '●',
  failed: '✕',
  skipped: '–',
}

const settled = computed(() => shown.value.status !== 'running')

/**
 * Whole stages rather than a synthetic percentage: the tool reports stage
 * transitions, so inventing sub-stage progress would be inventing data.
 *
 * A cancelled or failed run counts only what actually succeeded. Settling a run
 * early marks every unreached stage `skipped`, which is indistinguishable from
 * a stage skipped on request — so counting `skipped` as progress would draw a
 * full bar under the word "cancelled".
 */
const progressPct = computed(() => {
  const stages = shown.value.stages
  const ranToEnd = shown.value.status === 'running' || shown.value.status === 'succeeded'
  const done = stages.filter(
    (stage) => stage.status === 'succeeded' || (ranToEnd && stage.status === 'skipped'),
  ).length
  return stages.length === 0 ? 0 : Math.round((done / stages.length) * 100)
})

const STATUS_TONES: Record<string, string> = {
  running: 'text-foreground',
  succeeded: 'text-success',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground',
  queued: 'text-muted-foreground',
}

/**
 * The most recent log line, so the card tails rather than grows without end.
 *
 * Scanning the stage list backwards is not enough: `skipTests` marks the test
 * stage skipped, with a line of its own, before the build has written anything.
 * A plain reverse scan would show "skipped on request" while the build was
 * still logging. The stage actually in flight wins, then the last one to finish.
 */
const lastLog = computed(() => {
  const stages = shown.value.stages
  const running = stages.find((stage) => stage.status === 'running')
  const finished = stages.filter(
    (stage) => stage.status === 'succeeded' || stage.status === 'failed',
  )
  const source =
    running ?? finished.at(-1) ?? [...stages].reverse().find((s) => s.logTail.length > 0)
  return source?.logTail.at(-1)
})

/** What the bar means, for anyone who hears it rather than sees it. */
const progressLabel = computed(() => {
  const stages = shown.value.stages
  const done = stages.filter((stage) => stage.status === 'succeeded').length
  const running = stages.find((stage) => stage.status === 'running')
  const where = running ? `, ${running.name} in progress` : ''
  return `${done} of ${stages.length} stages complete${where} — ${shown.value.status}`
})

const cancelling = ref(false)

/**
 * Cancels out of band instead of aborting the turn.
 *
 * Aborting is what you would expect to work, and it is what the deploy tool
 * originally watched for. It does not: a browser that stops reading a streamed
 * response does not reliably abort the request on the Worker side, so the
 * tool's abort signal never fires and the deploy runs happily to completion
 * while the card claims it was cancelled. Posting the cancel makes it real —
 * the workspace records it, and the deploy loop reads that between stages.
 *
 * The turn is deliberately left running, so the run's last stream frame is the
 * cancelled deployment and the model gets to say what happened.
 */
async function cancel(): Promise<void> {
  cancelling.value = true
  try {
    // fetch() only throws on a network failure; a refused cancel arrives as a
    // response, and treating it as success would leave the run going silently.
    const res = await fetch(deploymentCancelEndpoint(props.deployment.id), { method: 'POST' })
    if (!res.ok) throw new Error(`cancel answered ${res.status}`)
  } catch (error) {
    console.warn('[deployment] cancel failed:', error)
    toast.error("Couldn't cancel the deployment", {
      description: 'It is still running. Try again in a moment.',
    })
  } finally {
    cancelling.value = false
    void workspace.hydrate()
  }
}

const canCancel = computed(() => props.live === true && !settled.value)
</script>

<template>
  <div
    data-testid="deployment-progress"
    :data-status="shown.status"
    class="bg-background min-w-0 rounded-md border px-3 py-2 text-xs"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="font-medium">
        <span class="font-mono">{{ shown.version }}</span> →
        <span class="font-mono">{{ shown.environment }}</span>
      </span>
      <span class="flex items-center gap-2">
        <span
          data-testid="deployment-status"
          aria-live="polite"
          :class="STATUS_TONES[shown.status]"
        >
          {{ shown.status }}
        </span>
        <Button
          v-if="canCancel"
          data-testid="deployment-cancel"
          size="sm"
          variant="outline"
          :disabled="cancelling"
          :aria-label="`Cancel deploying ${shown.version} to ${shown.environment}`"
          @click="cancel()"
        >
          {{ cancelling ? 'Cancelling…' : 'Cancel' }}
        </Button>
      </span>
    </div>

    <!--
      The role sits on the track, not the fill. At the start of a run the fill is
      a zero-width node inside an overflow-hidden parent, which assistive tech
      may not expose at all — so the thing that reports progress has to be the
      element that is always there.
    -->
    <div
      class="bg-muted mt-2 h-1 w-full overflow-hidden rounded-full"
      role="progressbar"
      :aria-valuenow="progressPct"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`Deploying ${shown.version} to ${shown.environment}`"
      :aria-valuetext="progressLabel"
    >
      <div
        class="bg-foreground h-full transition-[width] duration-300 motion-reduce:transition-none"
        :style="{ width: `${progressPct}%` }"
      />
    </div>

    <ul class="mt-2 flex flex-col gap-0.5">
      <li
        v-for="stage in shown.stages"
        :key="stage.name"
        :data-stage="stage.name"
        :data-stage-status="stage.status"
        class="flex items-center gap-2"
        :class="STAGE_TONES[stage.status]"
      >
        <!-- Mono: Geist has no ○ ◐ ● ✕, and the fallback sizes them unevenly. -->
        <span aria-hidden="true" class="font-mono">{{ STAGE_MARKS[stage.status] }}</span>
        <span class="font-mono">{{ stage.name }}</span>
        <span class="text-muted-foreground">{{ stage.status }}</span>
      </li>
    </ul>

    <p
      v-if="lastLog"
      data-testid="deployment-log"
      class="text-muted-foreground mt-2 truncate font-mono"
    >
      {{ lastLog }}
    </p>
  </div>
</template>
