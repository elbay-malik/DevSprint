/**
 * Trajectory evals for the six demo scenarios (Phase 10, ADR-0015).
 *
 * Every assertion here is copied from that scenario's own "Eval assertions"
 * block in docs/demo-scenarios.md. Those were written as acceptance criteria
 * and left as prose; this is what makes them run.
 *
 * Against the scripted mock these are deterministic and free, so they gate
 * every PR. What they prove is that the *application* honours a trajectory —
 * the gating, the ordering, the recovery. Whether a real model elicits that
 * trajectory is a different question, and `EVAL_MODEL_PROVIDER` is how to go
 * and ask it (it costs quota and is not deterministic, so it is not CI's job).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runScenario } from './harness'
import { resetApprovalSigningState } from '../agent/approvals'

/** Set to `groq` or `gemini` to run the same assertions against a live model. */
const modelProvider = process.env.EVAL_MODEL_PROVIDER ?? 'mock'

/**
 * A live run needs the provider keys inside the Worker env the harness builds.
 * This used to pass none, so `EVAL_MODEL_PROVIDER=groq` failed every scenario
 * before a model was ever called. That read as the model's failure, not ours.
 */
const liveEnv: Record<string, unknown> =
  modelProvider === 'mock'
    ? {}
    : Object.fromEntries(
        (['GROQ_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GROQ_MODEL', 'GEMINI_MODEL'] as const)
          .filter((name) => process.env[name])
          .map((name) => [name, process.env[name]]),
      )

const approveAll = () => ({ approved: true })

/**
 * Two tiers of assertion. Every model must satisfy the scenario's meaning;
 * the scripted mock must also produce its exact sentences, which is what keeps
 * a regression in the mock itself from hiding behind a loose check. A live
 * model writes "DS‑7" with a non-breaking hyphen and lays numbers out in
 * tables, so meaning-level checks compare normalized text.
 */
const live = modelProvider !== 'mock'
function plain(text: string): string {
  return text.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u00a0\u202f]/g, ' ')
}

if (live) {
  // Groq's free tier allows a few thousand tokens a minute per model, and one
  // agent turn spends about 2,000. Without a pause the rate limit, not the
  // model, decides which scenarios pass.
  vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })
}
let firstScenario = true

beforeEach(async () => {
  resetApprovalSigningState()
  if (live && !firstScenario) await new Promise((resolve) => setTimeout(resolve, 65_000))
  firstScenario = false
})

describe('S-A — multi-step chain into a rich card, then a gated write', () => {
  it('chains the documented tools and saves only after approval', async () => {
    const run = await runScenario({
      modelProvider,
      env: liveEnv,
      steps: [
        { prompt: 'Summarize Sprint 12 and draft release notes for v1.5.0.' },
        { prompt: 'Looks good, save it.', decide: approveAll },
      ],
    })

    // "Tools called in exactly this order." Exactly, for the mock; a live
    // model may add a harmless read afterwards, so it must call the four in
    // this order, with nothing gated slipping in before the diff.
    const documented = [
      'get_sprint_status',
      'list_issues',
      'diff_release_notes',
      'create_release_notes',
    ]
    if (live) {
      const positions = documented.map((name) => run.trajectory.indexOf(name))
      expect(positions.every((position) => position >= 0)).toBe(true)
      expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    } else {
      expect(run.trajectory).toEqual(documented)
    }
    // "`create_release_notes` never executes without a prior approval response."
    const saveTurn = run.turns.findIndex((turn) =>
      turn.approvals.some((approval) => approval.toolName === 'create_release_notes'),
    )
    expect(saveTurn).toBeGreaterThanOrEqual(0)
    const ranBeforeApproval = run.turns
      .slice(0, saveTurn + 1)
      .some((turn) => turn.results.some((result) => result.name === 'create_release_notes'))
    expect(ranBeforeApproval).toBe(false)

    // "The composed markdown mentions both DS-5 and DS-6."
    const draft = run.turns
      .flatMap((turn) => turn.toolCalls)
      .find((call) => call.name === 'diff_release_notes')?.input.draftMarkdown
    expect(String(draft)).toContain('DS-5')
    expect(String(draft)).toContain('DS-6')

    // And the note actually landed, as a draft.
    const saved = run.store.get().releaseNotes.find((note) => note.version === 'v1.5.0')
    expect(saved?.status).toBe('draft')
  })
})

describe('S-B — batch write with per-issue approval gates', () => {
  const CLOSE_OUT =
    "We're closing Sprint 12 today — mark every remaining open issue in the sprint as done."

  it('gates every write one at a time and respects the denial', async () => {
    const run = await runScenario({
      modelProvider,
      env: liveEnv,
      steps: [
        {
          prompt: CLOSE_OUT,
          // DS-11 is denied with a reason, per the scenario's step 9.
          decide: ({ input }) =>
            input.issueKey === 'DS-11'
              ? { approved: false, reason: 'Still blocked on vendor sandbox' }
              : { approved: true },
        },
      ],
    })

    // "Exactly 5 approval requests are emitted, one per issue key."
    const approvals = run.turns.flatMap((turn) => turn.approvals)
    expect(approvals).toHaveLength(5)
    expect(
      run.turns
        .flatMap((turn) => turn.toolCalls)
        .filter((call) => call.name === 'update_issue_status')
        .map((call) => call.input.issueKey),
    ).toEqual(['DS-7', 'DS-8', 'DS-9', 'DS-10', 'DS-11'])

    // "The denied `update_issue_status` call for DS-11 never mutates state."
    const board = run.store.get()
    expect(board.issues.find((issue) => issue.key === 'DS-11')?.status).toBe('blocked')
    for (const key of ['DS-7', 'DS-8', 'DS-9', 'DS-10']) {
      expect(board.issues.find((issue) => issue.key === key)?.status).toBe('done')
    }

    // "The agent's final text mentions the denial (and does not claim 5 closed)."
    const answer = plain(run.turns.at(-1)?.text ?? '')
    expect(answer).toContain('DS-11')
    expect(answer).not.toMatch(
      /\b(all (5|five)|5|five) issues (were |have been )?(closed|done|completed)\b/i,
    )
    // Any model must own the denial: say DS-11 was not done, or give the
    // user's reason back. The mock's exact sentence is its own tier.
    expect(answer).toMatch(
      /\bnot (approved|completed|closed|updated|done|changed)\b|vendor sandbox/i,
    )
    if (!live) expect(answer.toLowerCase()).toContain('not approved')
  })
})

describe('S-C — long-running deployment', () => {
  it('streams no progress before the approval is answered', async () => {
    const run = await runScenario({
      modelProvider,
      env: liveEnv,
      steps: [{ prompt: 'Deploy v1.5.0-rc.1 to staging.' }],
    })

    // "The approval response strictly precedes the first progress part."
    const asked = run.turns[0]!
    expect(asked.approvals.map((approval) => approval.toolName)).toEqual(['run_deployment'])
    expect(asked.results.some((result) => result.name === 'run_deployment')).toBe(false)
    // Nothing was booked, so the board shows no new deployment at all.
    expect(run.store.get().deployments.some((d) => d.version === 'v1.5.0-rc.1')).toBe(false)
  })

  // The simulated deploy sleeps through four real stages (~11s), which is the
  // point of scenario S-C — so this one genuinely needs longer than the 5s default.
  it('runs the deploy to completion once approved', { timeout: 40_000 }, async () => {
    const run = await runScenario({
      modelProvider,
      env: liveEnv,
      steps: [{ prompt: 'Deploy v1.5.0-rc.1 to staging.', decide: approveAll }],
    })

    const deployment = run.store.get().deployments.find((d) => d.version === 'v1.5.0-rc.1')
    expect(deployment?.status).toBe('succeeded')
    expect(deployment?.environment).toBe('staging')
    // Nothing left mid-flight for the board to render as still going.
    expect(deployment?.stages.every((stage) => stage.status !== 'running')).toBe(true)
  })
})

describe('S-D — burndown as a rich card', () => {
  it('fetches the series once and answers from it', async () => {
    const run = await runScenario({
      modelProvider,
      env: liveEnv,
      steps: [{ prompt: 'Is Sprint 12 on track? Show me the burndown.' }],
    })

    // "`get_burndown` is called exactly once (no redundant re-fetches)."
    expect(run.trajectory.filter((name) => name === 'get_burndown')).toHaveLength(1)

    // "The final answer references values grounded in the returned series
    // (committed 31, completed 8) and mentions DS-11." The series carries no
    // issue data, so DS-11 has to come from a read that does — this once
    // passed only because a stray list_issues happened to run.
    const answer = plain(run.turns.at(-1)?.text ?? '')
    expect(answer).toContain('31')
    expect(answer).toMatch(/\bbehind\b/i)
    expect(answer).toContain('DS-11')
    if (!live) {
      expect(answer).toContain('8 of 31 points done')
      expect(answer).toContain('behind the ideal line')
      expect(answer).not.toMatch(/\bon track\b/i)
      expect(run.trajectory).toEqual(['get_burndown', 'list_issues'])
    }
  })
})

describe('S-E — a typed error, recovered by searching', () => {
  it('searches for what the user meant instead of retrying the bad key', async () => {
    const run = await runScenario({
      modelProvider,
      env: liveEnv,
      steps: [
        {
          prompt: 'Mark DS-42 as done — the billing export shipped this morning.',
          decide: approveAll,
        },
        { prompt: 'Yes, that one.', decide: approveAll },
      ],
    })

    const writes = run.turns.flatMap((turn) =>
      turn.toolCalls.filter((call) => call.name === 'update_issue_status'),
    )
    const calls = run.turns.flatMap((turn) => turn.toolCalls)

    // What any model must do: find what the user meant by searching, and only
    // then change DS-7, behind an approval of its own.
    const firstDs7Write = calls.findIndex(
      (call) => call.name === 'update_issue_status' && call.input.issueKey === 'DS-7',
    )
    expect(firstDs7Write).toBeGreaterThan(-1)
    expect(calls.slice(0, firstDs7Write).some((call) => call.name === 'search_issues')).toBe(true)
    const approvedTools = run.turns.flatMap((turn) => turn.approvals.map((a) => a.toolName))
    expect(approvedTools).toContain('update_issue_status')

    if (!live) {
      // The scripted choreography, exactly as the step table writes it: try,
      // fail with a typed error, search, ask, then a second, separate card. A
      // live model may check before it writes and offer DS-7 straight as an
      // approval card, which is what the system prompt asks for ("the approval
      // card is the confirmation"), so this tier is the mock's alone.
      expect(run.trajectory[0]).toBe('update_issue_status')
      const failed = run.turns
        .flatMap((turn) => turn.results)
        .find((result) => result.name === 'update_issue_status')
      expect((failed?.output as { ok: boolean; error?: { code: string } })?.error?.code).toBe(
        'ISSUE_NOT_FOUND',
      )
      const afterError = run.trajectory.slice(run.trajectory.indexOf('update_issue_status') + 1)
      expect(afterError[0]).toBe('search_issues')

      const recovered = run.turns.find((turn) =>
        turn.toolCalls.some((c) => c.name === 'search_issues'),
      )
      expect(plain(recovered?.text ?? '')).toContain('Did you mean DS-7')

      const approvals = run.turns.flatMap((turn) => turn.approvals)
      expect(approvals).toHaveLength(2)
      expect(new Set(approvals.map((approval) => approval.approvalId)).size).toBe(2)
      expect(writes.map((write) => write.input)).toEqual([
        { issueKey: 'DS-42', status: 'done' },
        { issueKey: 'DS-7', status: 'done' },
      ])
    }

    // "Final workspace state: DS-7 is done; no issue DS-42 exists."
    const issues = run.store.get().issues
    expect(issues.find((issue) => issue.key === 'DS-7')?.status).toBe('done')
    expect(issues.some((issue) => issue.key === 'DS-42')).toBe(false)
  })
})

describe('S-F — the same workspace, from an external MCP host', () => {
  it('sources exactly the four issue tools from the MCP server', async () => {
    // S-F's point is that the write arrives from a host we do not own, so this
    // is asserted from the side apps/api actually owns: which tools it hands
    // over to the MCP server rather than defining itself. That the server
    // registers exactly these four is asserted in apps/mcp-issues' own suite,
    // against the real `McpServer` — a dependency this package does not have.
    const { MCP_OWNED_TOOL_NAMES } = await import('../agent/tools')

    expect([...MCP_OWNED_TOOL_NAMES].sort()).toEqual([
      'create_issue',
      'list_issues',
      'search_issues',
      'update_issue_status',
    ])
  })

  it('creates DS-14 in the backlog and the shared board sees it', async () => {
    const { createLocalWorkspaceApi, createWorkspaceStore } = await import('../workspace/store')
    const store = createWorkspaceStore()
    const workspace = createLocalWorkspaceApi(store)

    // "`create_issue` produces DS-14 with `sprintId: null` (backlog)."
    const created = await workspace.createIssue({
      title: 'Add CSV export progress indicator',
      type: 'feature',
      priority: 'medium',
      sprintId: null,
    })

    expect(created.ok).toBe(true)
    const issue = created.ok ? created.data.issue : undefined
    expect(issue?.key).toBe('DS-14')
    expect(issue?.sprintId).toBeNull()
    expect(issue?.title).toBe('Add CSV export progress indicator')

    // The same board the SPA reads — one workspace, two clients.
    expect(store.get().issues.find((candidate) => candidate.key === 'DS-14')?.type).toBe('feature')

    // The optional follow-up: "Move DS-14 to in progress."
    const moved = await workspace.updateIssueStatus({ issueKey: 'DS-14', status: 'in_progress' })
    expect(moved.ok).toBe(true)
    expect(store.get().issues.find((candidate) => candidate.key === 'DS-14')?.status).toBe(
      'in_progress',
    )
  })

  it('validates server-side even though the host owns the permission prompt', async () => {
    const { WRITE_TOOL_INPUT_SCHEMAS } = await import('@devsprint/shared/tools')

    // "Server-side input validation runs even though the approval UX belongs
    // to the host" — the host's prompt is not a substitute for a schema.
    expect(
      WRITE_TOOL_INPUT_SCHEMAS.create_issue.safeParse({ title: '', type: 'feature' }).success,
    ).toBe(false)
    expect(
      WRITE_TOOL_INPUT_SCHEMAS.create_issue.safeParse({ title: 'ok', type: 'nonsense' }).success,
    ).toBe(false)
  })
})
