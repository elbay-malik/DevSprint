import { beforeEach, describe, expect, it } from 'vitest'
import type { Deployment } from '@devsprint/shared'
import { runDeployment } from './agent/deployment'
import { fakeWorkspaceBinding } from '../test/workspace-binding'
import { createLocalWorkspaceApi } from './workspace/store'

/** Stage durations are irrelevant to the logic, so the suite does not wait. */
const FAST = { build: 0, test: 0, migrate: 0, release: 0 }

function workspaceApi() {
  const { store } = fakeWorkspaceBinding()
  return { store, api: createLocalWorkspaceApi(store) }
}

async function collect(generator: AsyncGenerator<unknown>): Promise<Deployment[]> {
  const seen: Deployment[] = []
  for await (const snapshot of generator) {
    const result = snapshot as { ok: boolean; data?: { deployment: Deployment } }
    if (result.ok && result.data) seen.push(structuredClone(result.data.deployment))
  }
  return seen
}

describe('runDeployment', () => {
  let workspace: ReturnType<typeof workspaceApi>

  beforeEach(() => {
    workspace = workspaceApi()
  })

  it('walks the stages in order and ends succeeded', async () => {
    const snapshots = await collect(
      runDeployment({
        workspace: workspace.api,
        input: { environment: 'staging', version: 'v1.5.0-rc.1', skipTests: false },
        durations: FAST,
      }),
    )

    const final = snapshots.at(-1)!
    expect(final.status).toBe('succeeded')
    expect(final.stages.map((stage) => stage.name)).toEqual(['build', 'test', 'migrate', 'release'])
    expect(final.stages.every((stage) => stage.status === 'succeeded')).toBe(true)
    expect(final.version).toBe('v1.5.0-rc.1')
    expect(final.triggeredById).toBe('agent')
  })

  it('reports progress as it goes rather than only at the end', async () => {
    const snapshots = await collect(
      runDeployment({
        workspace: workspace.api,
        input: { environment: 'staging', version: 'v1.5.0-rc.1', skipTests: false },
        durations: FAST,
      }),
    )

    // Each yield reaches the client as a preliminary result, which is what
    // moves the progress card.
    expect(snapshots.length).toBeGreaterThan(4)
    const running = snapshots.filter((deployment) =>
      deployment.stages.some((stage) => stage.status === 'running'),
    )
    expect(running.length).toBeGreaterThan(0)
    // Log lines accumulate on the stage that produced them.
    expect(snapshots.at(-1)!.stages[0]?.logTail.join(' ')).toContain('build completed')
  })

  it('stops where it got to when the run is cancelled (S-C variant C2)', async () => {
    const controller = new AbortController()
    const generator = runDeployment({
      workspace: workspace.api,
      input: { environment: 'staging', version: 'v1.5.0-rc.1', skipTests: false },
      durations: FAST,
      abortSignal: controller.signal,
    })

    const seen: Deployment[] = []
    for await (const snapshot of generator) {
      const result = snapshot as { ok: boolean; data?: { deployment: Deployment } }
      if (result.ok && result.data) seen.push(structuredClone(result.data.deployment))
      // Cancel once the build stage is under way.
      if (seen.at(-1)?.stages[0]?.status === 'running') controller.abort()
    }

    const final = seen.at(-1)!
    expect(final.status).toBe('cancelled')
    // Not failed, and not left mid-flight: unreached stages read as skipped.
    expect(final.stages.some((stage) => stage.status === 'running')).toBe(false)
    expect(final.stages.some((stage) => stage.status === 'pending')).toBe(false)
    // And the board agrees with the card.
    const stored = workspace.store.get().deployments.at(-1)
    expect(stored?.status).toBe('cancelled')
  })

  it('stops when the workspace is cancelled out of band (S-C variant C2)', async () => {
    // What the Cancel button actually does. It posts to the api rather than
    // aborting the turn, because a browser that stops reading a stream does not
    // reliably abort the Worker's request — so the run must notice a cancel it
    // was never signalled about.
    const generator = runDeployment({
      workspace: workspace.api,
      input: { environment: 'staging', version: 'v1.5.0-rc.1', skipTests: false },
      durations: FAST,
    })

    const seen: Deployment[] = []
    let posted = false
    for await (const snapshot of generator) {
      const result = snapshot as { ok: boolean; data?: { deployment: Deployment } }
      if (result.ok && result.data) seen.push(structuredClone(result.data.deployment))
      if (!posted && seen.at(-1)?.stages[0]?.status === 'running') {
        posted = true
        await workspace.api.finishDeployment({
          deploymentId: seen[0]?.id ?? '',
          status: 'cancelled',
        })
      }
    }

    const final = seen.at(-1)!
    expect(final.status).toBe('cancelled')
    // The run stopped where it was rather than carrying on to release.
    expect(final.stages.some((stage) => stage.status === 'running')).toBe(false)
    expect(final.stages.find((stage) => stage.name === 'release')?.status).toBe('skipped')
    expect(workspace.store.get().deployments.at(-1)?.status).toBe('cancelled')
  })

  it('keeps a cancel that lands as the last stage closes', async () => {
    // The narrow window: the run has just written its final stage as succeeded
    // and is about to settle. The Cancel button is still on screen, because the
    // deployment itself is still `running`. Whichever write went last used to
    // win, so the click could be discarded with a 200 and no error anywhere.
    const generator = runDeployment({
      workspace: workspace.api,
      input: { environment: 'staging', version: 'v1.5.0-rc.1', skipTests: false },
      durations: FAST,
    })

    const seen: Deployment[] = []
    for await (const snapshot of generator) {
      const result = snapshot as { ok: boolean; data?: { deployment: Deployment } }
      if (result.ok && result.data) seen.push(structuredClone(result.data.deployment))
      const last = seen.at(-1)
      const release = last?.stages.find((stage) => stage.name === 'release')
      if (last?.status === 'running' && release?.status === 'succeeded') {
        await workspace.api.finishDeployment({ deploymentId: last.id, status: 'cancelled' })
      }
    }

    expect(seen.at(-1)?.status).toBe('cancelled')
    expect(workspace.store.get().deployments.at(-1)?.status).toBe('cancelled')
  })

  it('settles the run even when the consumer walks away mid-stream', async () => {
    // The SDK can stop consuming the generator instead of running it out. Left
    // unhandled the workspace goes on saying `running`, and startDeployment then
    // refuses every later deploy to that environment with DEPLOY_IN_PROGRESS —
    // one abandoned turn would brick deploys until someone reset the demo.
    const generator = runDeployment({
      workspace: workspace.api,
      input: { environment: 'staging', version: 'v1.5.0-rc.1', skipTests: false },
      durations: FAST,
    })

    // Take only the first frame — the deployment now exists and is running.
    const first = (await generator.next()).value as { data: { deployment: Deployment } }
    expect(workspace.store.get().deployments.at(-1)?.status).toBe('running')

    await generator.return(undefined)

    expect(workspace.store.get().deployments.at(-1)?.status).toBe('cancelled')
    expect(first.data.deployment.id).toBe(workspace.store.get().deployments.at(-1)?.id)

    // And the environment is free again.
    const next = runDeployment({
      workspace: workspace.api,
      input: { environment: 'staging', version: 'v1.6.0', skipTests: false },
      durations: FAST,
    })
    const result = (await next.next()).value as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('stops rather than walking the remaining stages blind after a failed write', async () => {
    let writes = 0
    const failing = {
      ...workspace.api,
      setDeploymentStage: () => {
        writes += 1
        return Promise.resolve({
          ok: false,
          error: { code: 'INVALID_INPUT', message: 'gone' },
        } as const)
      },
    }

    const snapshots: { ok: boolean }[] = []
    for await (const snapshot of runDeployment({
      workspace: failing,
      input: { environment: 'staging', version: 'v1.5.0-rc.1', skipTests: false },
      durations: FAST,
    })) {
      snapshots.push(snapshot)
    }

    // It gave up on the first failure instead of sleeping through four stages
    // and reporting an outcome it never saw.
    expect(writes).toBe(1)
    expect(snapshots.at(-1)?.ok).toBe(false)
    expect(snapshots.filter((snapshot) => snapshot.ok)).toHaveLength(1)
  })

  it('honours skipTests without pretending the tests ran', async () => {
    const snapshots = await collect(
      runDeployment({
        workspace: workspace.api,
        input: { environment: 'staging', version: 'v1.5.0-rc.1', skipTests: true },
        durations: FAST,
      }),
    )

    const test = snapshots.at(-1)!.stages.find((stage) => stage.name === 'test')
    expect(test?.status).toBe('skipped')
    expect(test?.logTail.join(' ')).not.toContain('specs passed')
  })

  it('refuses a version already live in that environment', async () => {
    const snapshots = runDeployment({
      workspace: workspace.api,
      // dep-5 in the seed is v1.4.2, succeeded, in production.
      input: { environment: 'production', version: 'v1.4.2', skipTests: false },
      durations: FAST,
    })

    const results: { ok: boolean; error?: { code: string } }[] = []
    for await (const snapshot of snapshots) {
      results.push(snapshot)
    }

    expect(results).toHaveLength(1)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.error?.code).toBe('VERSION_EXISTS')
  })

  it('refuses a second run while one is already going', async () => {
    const first = runDeployment({
      workspace: workspace.api,
      input: { environment: 'staging', version: 'v2.0.0', skipTests: false },
      durations: FAST,
    })
    await first.next()

    const second = runDeployment({
      workspace: workspace.api,
      input: { environment: 'staging', version: 'v2.0.1', skipTests: false },
      durations: FAST,
    })
    const result = (await second.next()).value as { ok: boolean; error?: { code: string } }

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('DEPLOY_IN_PROGRESS')
  })
})
