import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deployment, StageName, StageStatus } from '@devsprint/shared'
import DeploymentProgressCard from './DeploymentProgressCard.vue'
import { useWorkspaceStore } from '@/stores/workspace'

const STAGES: StageName[] = ['build', 'test', 'migrate', 'release']

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  const statuses = overrides.stages ?? []
  return {
    id: 'dep-99',
    projectId: 'proj-1',
    version: 'v1.5.0-rc.1',
    environment: 'staging',
    status: 'running',
    commitSha: 'abc1234',
    triggeredById: 'agent',
    startedAt: '2026-07-01T09:00:00Z',
    finishedAt: null,
    stages:
      statuses.length > 0
        ? statuses
        : STAGES.map((name) => ({
            name,
            status: 'pending' satisfies StageStatus,
            startedAt: null,
            finishedAt: null,
            logTail: [],
          })),
    ...overrides,
  }
}

function stagesWith(map: Partial<Record<StageName, StageStatus>>, logs: string[] = []) {
  return STAGES.map((name) => ({
    name,
    status: map[name] ?? 'pending',
    startedAt: null,
    finishedAt: null,
    logTail: name === 'build' ? logs : [],
  }))
}

function mountCard(props: { deployment: Deployment; live?: boolean }) {
  return mount(DeploymentProgressCard, { props })
}

describe('DeploymentProgressCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('shows each stage where it has got to', () => {
    const wrapper = mountCard({
      deployment: deployment({
        stages: stagesWith({ build: 'succeeded', test: 'running' }),
      }),
      live: true,
    })

    expect(wrapper.get('[data-stage="build"]').attributes('data-stage-status')).toBe('succeeded')
    expect(wrapper.get('[data-stage="test"]').attributes('data-stage-status')).toBe('running')
    expect(wrapper.get('[data-stage="release"]').attributes('data-stage-status')).toBe('pending')
    // A quarter of the stages are done, so the bar says a quarter.
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
  })

  it('tails the log rather than growing without end', () => {
    const wrapper = mountCard({
      deployment: deployment({
        stages: stagesWith({ build: 'running' }, ['checked out abc1234', 'build completed']),
      }),
      live: true,
    })

    const log = wrapper.get('[data-testid="deployment-log"]').text()
    expect(log).toBe('build completed')
    expect(log).not.toContain('checked out')
  })

  it('does not draw a full bar under the word cancelled', () => {
    // Settling a run early marks every unreached stage `skipped`, so counting
    // skipped as done would show 100% for a run that stopped after build.
    const wrapper = mountCard({
      deployment: deployment({
        status: 'cancelled',
        stages: stagesWith({ build: 'succeeded', test: 'skipped', migrate: 'skipped' }),
      }),
      live: true,
    })

    const bar = wrapper.get('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('25')
    expect(bar.attributes('aria-valuetext')).toContain('1 of 4 stages complete')
  })

  it('fills the bar as wide as the progress it reports', () => {
    // aria-valuenow is only the claim; the fill's width is what is drawn, and a
    // unitless width is invalid CSS that leaves the bar empty all run.
    const wrapper = mountCard({
      deployment: deployment({ stages: stagesWith({ build: 'succeeded', test: 'running' }) }),
      live: true,
    })
    const fill = wrapper.get('[role="progressbar"] > div')
    expect(fill.attributes('style')).toContain('width: 25%')
  })

  it('still counts a deliberately skipped stage on a run that finished', () => {
    // skipTests is not lost progress: the run did everything it was asked to.
    const wrapper = mountCard({
      deployment: deployment({
        status: 'succeeded',
        stages: stagesWith({
          build: 'succeeded',
          test: 'skipped',
          migrate: 'succeeded',
          release: 'succeeded',
        }),
      }),
      live: true,
    })

    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100')
  })

  it('tails the stage that is running, not a later one skipped up front', () => {
    // skipTests writes the test stage's line before the build has logged
    // anything, so a plain reverse scan shows the wrong line for the whole run.
    const stages = stagesWith({ build: 'running', test: 'skipped' }, ['checked out abc1234'])
    stages[1]!.logTail = ['skipped on request']

    const wrapper = mountCard({ deployment: deployment({ stages }), live: true })

    expect(wrapper.get('[data-testid="deployment-log"]').text()).toBe('checked out abc1234')
  })

  it('offers Cancel only while a live run is going', () => {
    const running = { deployment: deployment(), live: true }
    expect(mountCard(running).find('[data-testid="deployment-cancel"]').exists()).toBe(true)

    // Settled: there is nothing left to cancel.
    const done = { deployment: deployment({ status: 'succeeded' }), live: true }
    expect(mountCard(done).find('[data-testid="deployment-cancel"]').exists()).toBe(false)

    // Replayed from the transcript: the run is long over.
    const replayed = { deployment: deployment() }
    expect(mountCard(replayed).find('[data-testid="deployment-cancel"]').exists()).toBe(false)
  })

  it('cancels by posting to the api, not by aborting the turn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountCard({ deployment: deployment(), live: true })
    await wrapper.get('[data-testid="deployment-cancel"]').trigger('click')

    // A stopped read of the stream does not reliably abort the Worker's
    // request, so the cancel has to be said out of band to be real.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toContain('/api/deployments/dep-99/cancel')
    expect(init.method).toBe('POST')
  })

  it('reads a settled run back from the board, not from the message', () => {
    const store = useWorkspaceStore()
    store.workspace.deployments = [deployment({ status: 'cancelled' })]

    // The message still carries whatever the stream last managed to send.
    const wrapper = mountCard({ deployment: deployment({ status: 'running' }) })

    expect(wrapper.attributes('data-status')).toBe('cancelled')
    expect(wrapper.get('[data-testid="deployment-status"]').text()).toBe('cancelled')
  })

  it('keeps showing the live run while the turn is still going', () => {
    const store = useWorkspaceStore()
    // The board lags the stream: it is only re-read when the turn settles.
    store.workspace.deployments = [deployment({ status: 'queued' })]

    const wrapper = mountCard({
      deployment: deployment({ stages: stagesWith({ build: 'running' }) }),
      live: true,
    })

    expect(wrapper.attributes('data-status')).toBe('running')
    expect(wrapper.get('[data-stage="build"]').attributes('data-stage-status')).toBe('running')
  })

  it('marks state with a glyph as well as a colour', () => {
    const wrapper = mountCard({
      deployment: deployment({ stages: stagesWith({ build: 'succeeded', test: 'skipped' }) }),
      live: true,
    })

    // Colour alone would not survive greyscale or colour blindness.
    expect(wrapper.get('[data-stage="build"]').text()).toContain('●')
    expect(wrapper.get('[data-stage="test"]').text()).toContain('–')
  })
})
