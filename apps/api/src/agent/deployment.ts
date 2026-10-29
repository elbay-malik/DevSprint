import type { ToolResult } from '@devsprint/shared'
import type { RunDeploymentData, RunDeploymentInput, WorkspaceApi } from '@devsprint/shared/tools'
import { DEPLOYMENT_STAGES } from '../workspace/mutations'

/**
 * How long each stage takes. These are the durations scenario S-C is written
 * against — long enough that a person can watch the stages flip and hit Cancel
 * mid-run, which is the whole point of the card.
 */
export const STAGE_DURATIONS_MS: Record<string, number> = {
  build: 3000,
  test: 4000,
  migrate: 2000,
  release: 2000,
}

/** One line per stage, so the tail reads like a real build log. */
const STAGE_LOGS: Record<string, (input: RunDeploymentInput, sha: string) => string[]> = {
  build: (input, sha) => [`checked out ${sha}`, `build completed for ${input.version}`],
  test: () => ['RUN e2e suite: 42 specs', 'all specs passed'],
  migrate: () => ['no pending migrations'],
  release: (input) => [`released ${input.version} to ${input.environment}`],
}

export interface RunDeploymentOptions {
  workspace: WorkspaceApi
  input: RunDeploymentInput
  abortSignal?: AbortSignal
  /**
   * Keeps the Worker alive for a write the request no longer waits on. When a
   * client disconnects, Workers cancels anything not awaited by the handler, so
   * without this the cancelled status is simply lost.
   */
  waitUntil?: (promise: Promise<unknown>) => void
  /** Overridden in tests so a suite does not wait eleven seconds. */
  durations?: Record<string, number>
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** Resolves on time, or early when the run is cancelled. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * The simulated deploy, as an async generator.
 *
 * Every yield is a complete result envelope, which the SDK streams to the client
 * as a preliminary tool result — so the progress card redraws from the same
 * shape it will eventually settle on, rather than from a separate event type.
 *
 * Cancellation is the reason each stage is persisted as it happens rather than
 * only at the end. Cancelling writes the terminal status to the workspace from
 * an api route (ADR-0013), so the run learns it was cancelled from the next
 * write it makes, and stops where it got to. The board then shows a finished
 * deployment rather than one stuck mid-flight (scenario S-C, C2).
 */
export async function* runDeployment({
  workspace,
  input,
  abortSignal,
  waitUntil,
  durations = STAGE_DURATIONS_MS,
  sleep = defaultSleep,
}: RunDeploymentOptions): AsyncGenerator<ToolResult<RunDeploymentData>> {
  const started = await workspace.startDeployment(input)
  if (!started.ok) {
    yield started
    return
  }

  const deploymentId = started.data.deployment.id
  const sha = started.data.deployment.commitSha

  /**
   * Every frame carries the run's cancel token, not just the first: the card
   * redraws from whichever frame is latest, and its Cancel button needs the
   * token to be heard (ADR-0024).
   */
  const { cancelToken } = started.data
  const withToken = (result: ToolResult<RunDeploymentData>): ToolResult<RunDeploymentData> =>
    result.ok && cancelToken !== undefined
      ? { ok: true, data: { ...result.data, cancelToken } }
      : result

  // Read through a call: the signal fires while we await, and a direct check
  // would be narrowed away by the earlier one.
  const cancelled = () => abortSignal?.aborted === true

  /** The run's outcome, written exactly once by whoever reaches it first. */
  let settling: Promise<ToolResult<RunDeploymentData>> | undefined

  /**
   * Whether someone has ended the run out from under us.
   *
   * Cancelling cannot rely on the request's abort signal: a client that
   * disconnects mid-stream does not reliably abort the Worker's request, so the
   * Cancel button posts to the api instead and the workspace becomes the signal
   * (ADR-0013). Every write returns the current deployment, which is what we
   * read here.
   *
   * A failed write stops the run too. It is the one case where we cannot tell
   * what state the deployment is in, and carrying on would mean walking the
   * remaining stages blind and reporting an outcome we did not observe.
   */
  /** Set when the run stops because a write failed, rather than because it ended. */
  let writeFailed = false

  const stopped = (result: ToolResult<RunDeploymentData>) => {
    if (result.ok && result.data.deployment.status === 'running') return false
    if (result.ok) {
      // Someone else already wrote a terminal status — a cancel, most likely.
      // Settling over it would overwrite an outcome the user was told about.
      settling ??= Promise.resolve(result)
      return true
    }
    // A failed write is different, and treating the two alike left a real
    // hole: memoising the error envelope here made `settle` and the `finally`
    // backstop both short-circuit, so `finishDeployment` never ran and the
    // deployment stayed `running` forever — which then blocks every later
    // deploy to that environment with DEPLOY_IN_PROGRESS. The run still stops,
    // but it has to settle as `failed` on the way out.
    writeFailed = true
    return true
  }

  /**
   * Writes the terminal status, once.
   *
   * `finishDeployment` refuses a deployment that already settled, which is how
   * a cancel that landed in the gap between our last read and this write keeps
   * its outcome. When that happens we report what the workspace actually holds
   * rather than the status we were about to claim.
   */
  const settle = (status: 'succeeded' | 'cancelled' | 'failed') => {
    settling ??= workspace.finishDeployment({ deploymentId, status }).then(async (result) => {
      if (result.ok) return result
      const current = (await workspace.snapshot()).deployments.find(
        (candidate) => candidate.id === deploymentId,
      )
      return current ? { ok: true as const, data: { deployment: current } } : result
    })
    return settling
  }

  const cancel = () => {
    // Not `waitUntil?.(settle(...))`: an optional call skips its arguments, so
    // that form would silently perform no write at all when waitUntil is absent.
    const pending = settle(writeFailed ? 'failed' : 'cancelled')
    // The request may already be over, so the handler is not awaiting this.
    waitUntil?.(pending)
  }

  // Registered before the first yield, and before any await that could suspend
  // us. A deployment exists in the workspace from `startDeployment` onwards, so
  // every path out from here has to be able to stop it saying `running`.
  abortSignal?.addEventListener('abort', cancel, { once: true })

  try {
    yield started

    // Labelled so that noticing a cancel inside the log loop leaves the run the
    // same way noticing it anywhere else does: one exit, one final yield.
    stages: for (const stage of DEPLOYMENT_STAGES) {
      // `skipTests` marks the test stage skipped up front; do not resurrect it.
      const current = started.data.deployment.stages.find((candidate) => candidate.name === stage)
      if (current !== undefined && current.status === 'skipped') continue

      if (cancelled()) break stages

      const opened = await workspace.setDeploymentStage({ deploymentId, stage, status: 'running' })
      yield withToken(opened)
      if (stopped(opened)) break stages

      await sleep(durations[stage] ?? 0, abortSignal)
      if (cancelled()) break stages

      for (const line of STAGE_LOGS[stage]?.(input, sha) ?? []) {
        const logged = await workspace.setDeploymentStage({
          deploymentId,
          stage,
          status: 'running',
          logLine: line,
        })
        yield withToken(logged)
        // Cancelling writes the terminal status straight to the workspace, so
        // the next write is what tells us to stop.
        if (stopped(logged)) break stages
      }

      const closed = await workspace.setDeploymentStage({
        deploymentId,
        stage,
        status: 'succeeded',
      })
      yield withToken(closed)
      if (stopped(closed)) break stages
    }

    // How the run ended, however it ended. A consumer still listening sees it;
    // one that has gone away does not, which is why settling never waits on the
    // yield itself.
    yield withToken(await settle(writeFailed ? 'failed' : cancelled() ? 'cancelled' : 'succeeded'))
  } finally {
    abortSignal?.removeEventListener('abort', cancel)
    // The generator can be closed early — the SDK may simply stop consuming it,
    // in which case nothing above runs again. Without this the workspace would
    // go on saying `running`, and `startDeployment` would refuse every later
    // deploy to that environment with DEPLOY_IN_PROGRESS.
    cancel()
  }
}
