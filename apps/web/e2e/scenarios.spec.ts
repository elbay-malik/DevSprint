import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { expect, test, type Page } from '@playwright/test'
import { MCP, recordStream, resetBoard, send, storedWorkspace, turnSettled } from './support'

/**
 * The six demo scenarios of docs/demo-scenarios.md, in the browser.
 *
 * Each test uses the scenario's verbatim prompts and transcribes its "Eval
 * assertions" block, so the same acceptance criteria hold here as in
 * apps/api/src/evals — but against what the page drew, what the browser was
 * streamed, and what the Durable Object stored. Where a scenario's expected UI
 * describes something unbuilt, the doc says so and this file does not pretend.
 */

test.beforeEach(async ({ request }) => {
  await resetBoard(request)
})

async function openBoard(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
}

function userMessage(page: Page, text: string) {
  return page.locator('[data-testid="chat-message"][data-role="user"]', { hasText: text })
}

function assistantText(page: Page) {
  return page.locator('[data-testid="chat-message"][data-role="assistant"]')
}

test.describe('S-A — sprint summary → release-notes draft with diff', () => {
  test('diffs the draft against v1.4.2, then saves it only once approved', async ({
    page,
    request,
  }) => {
    const stream = recordStream(page)
    await openBoard(page)

    await send(page, 'Summarize Sprint 12 and draft release notes for v1.5.0.')
    await expect(userMessage(page, 'Summarize Sprint 12')).toBeVisible()

    // Step 3: the shipped work is DS-5 and DS-6, and only those.
    const table = page.getByTestId('issue-table')
    await expect(table.locator('[data-issue-key]')).toHaveCount(2)
    await expect(table.locator('[data-issue-key="DS-5"]')).toBeVisible()
    await expect(table.locator('[data-issue-key="DS-6"]')).toBeVisible()

    // Step 5, and "the diff card renders before any approval is requested".
    const diff = page.getByTestId('release-notes-diff')
    await expect(diff).toContainText('v1.4.2')
    await turnSettled(page)
    await expect(page.getByTestId('approval-card')).toHaveCount(0)
    const chat = page.getByTestId('chat-pane')
    await expect(chat).toContainText('23 of 31 points remaining')
    await expect(chat).toContainText('Blocked: DS-11')
    expect((await storedWorkspace(request)).releaseNotes.map((note) => note.version)).toEqual([
      'v1.4.2',
    ])

    // Steps 6–7: one gate for the save, and still nothing stored while it waits.
    await send(page, 'Looks good, save it.')
    const card = page.getByTestId('approval-card')
    await expect(card).toHaveCount(1)
    await expect(card).toHaveAttribute('data-tool', 'create_release_notes')
    expect((await storedWorkspace(request)).releaseNotes).toHaveLength(1)

    // Step 8.
    await card.getByTestId('approval-approve').click()
    await expect(card.getByTestId('approval-outcome')).toContainText('Approved by you')
    await expect(chat).toContainText('Saved v1.5.0 release notes as a draft.')

    // "Saved release note has status 'draft' and version 'v1.5.0'."
    const saved = (await storedWorkspace(request)).releaseNotes.find(
      (note) => note.version === 'v1.5.0',
    )
    expect(saved?.status).toBe('draft')

    // "Tools called in exactly this order", with the step table's arguments.
    const calls = await stream.calls()
    expect(calls.map((call) => call.name)).toEqual([
      'get_sprint_status',
      'list_issues',
      'diff_release_notes',
      'create_release_notes',
    ])
    expect(calls[0]?.input).toEqual({ sprintId: 'sprint-12' })
    // The issue tools come over MCP, whose schema fills in defaults (`limit`),
    // so the step table's arguments are matched as a subset.
    expect(calls[1]?.input).toMatchObject({ sprintId: 'sprint-12', status: 'done' })
    const outputs = await stream.outputs()
    expect(outputs.get(calls[2]?.id ?? '')).toMatchObject({
      ok: true,
      data: { baseVersion: 'v1.4.2' },
    })

    // "The composed markdown mentions both DS-5 and DS-6", and what was saved
    // is the draft the user was shown, not a fresh one.
    const draft = calls[2]?.input.draftMarkdown
    expect(draft).toContain('DS-5')
    expect(draft).toContain('DS-6')
    expect(calls[3]?.input).toEqual({ version: 'v1.5.0', markdown: draft })
    expect(saved?.markdown).toBe(draft)

    // "create_release_notes never executes without a prior approval response."
    const events = await stream.events()
    const saveId = calls[3]?.id
    const asked = events.findIndex(
      (event) => event.type === 'tool-approval-request' && event.toolCallId === saveId,
    )
    const ran = events.findIndex(
      (event) => event.type === 'tool-output-available' && event.toolCallId === saveId,
    )
    expect(asked).toBeGreaterThan(-1)
    expect(ran).toBeGreaterThan(asked)
  })
})

test.describe('S-B — batch write with per-issue approval gates', () => {
  const CLOSE_OUT =
    "We're closing Sprint 12 today — mark every remaining open issue in the sprint as done."
  const OPEN = ['DS-7', 'DS-8', 'DS-9', 'DS-10', 'DS-11']

  test('gates each of the five writes and keeps DS-11 blocked when denied', async ({
    page,
    request,
  }) => {
    const stream = recordStream(page)
    await openBoard(page)
    await send(page, CLOSE_OUT)

    // "Exactly 5 separate ApprovalCards render (never a single batch card)",
    // one per open issue, in the order list_issues returned them.
    const cards = page.getByTestId('approval-card')
    await expect(cards).toHaveCount(5)
    for (const [index, key] of OPEN.entries()) {
      await expect(cards.nth(index).getByTestId('approval-headline')).toContainText(key)
    }
    await expect(page.getByTestId('chat-input')).toBeDisabled()

    // "Nothing is written until a card is answered."
    const before = await storedWorkspace(request)
    for (const key of OPEN) {
      expect(before.issues.find((issue) => issue.key === key)?.status).not.toBe('done')
    }

    for (let index = 0; index < 4; index += 1) {
      await cards.nth(index).getByTestId('approval-approve').click()
    }
    const denied = cards.nth(4)
    await denied.getByTestId('approval-reason').fill('Still blocked on vendor sandbox')
    await denied.getByTestId('approval-deny').click()
    // The record says who decided, when, and why.
    await expect(denied.getByTestId('approval-outcome')).toContainText(
      /Denied by you at \d\d.\d\d: “Still blocked on vendor sandbox”\./,
    )
    await turnSettled(page)
    // Once decided, each card still reads as the change it allowed, from → to,
    // although the board has since moved the issue.
    await expect(cards.first().getByTestId('approval-headline')).toHaveText(
      'DS-7: In review → Done',
    )

    // "The agent's final text mentions the denial" and "does not claim 5
    // issues were closed". The cards show each move, so the answer is the tally.
    const answer = assistantText(page).last()
    await expect(answer).toContainText(
      '4 of the 5 issues are now Done. DS-11 was not approved (Still blocked on vendor sandbox), so nothing changed.',
    )
    await expect(answer).not.toContainText(/5 issues (were )?(closed|done)/i)

    // The board and the store agree: four moved, DS-11 never left Blocked.
    const done = page.getByTestId('board-column-done')
    for (const key of OPEN.slice(0, 4)) {
      await expect(done.locator(`[data-issue-key="${key}"]`)).toBeVisible()
    }
    await expect(
      page.getByTestId('board-column-blocked').locator('[data-issue-key="DS-11"]'),
    ).toBeVisible()
    const after = await storedWorkspace(request)
    expect(after.issues.find((issue) => issue.key === 'DS-11')?.status).toBe('blocked')

    // "Exactly 5 approval requests, one per issue key", each a plain
    // { issueKey, status: 'done' } — and the denied one never produced output.
    const calls = await stream.calls()
    expect(calls[0]).toMatchObject({ name: 'list_issues', input: { sprintId: 'sprint-12' } })
    const writes = calls.filter((call) => call.name === 'update_issue_status')
    expect(writes.map((write) => write.input)).toEqual(
      OPEN.map((issueKey) => ({ issueKey, status: 'done' })),
    )
    const events = await stream.events()
    expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(5)
    const outputs = await stream.outputs()
    expect(outputs.has(writes[4]?.id ?? '')).toBe(false)
  })
})

test.describe('S-C — long-running deployment with live progress', () => {
  test('runs only once approved, and streams every stage to succeeded', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    const stream = recordStream(page)
    await openBoard(page)
    await send(page, 'Deploy v1.5.0-rc.1 to staging.')

    const approval = page.getByTestId('approval-card')
    await expect(approval).toHaveAttribute('data-tool', 'run_deployment')
    await expect(page.getByTestId('deployment-progress')).toHaveCount(0)
    await approval.getByTestId('approval-approve').click()

    // The card moves on its own while the run is going, not only at the end.
    const card = page.getByTestId('deployment-progress')
    await expect(card).toHaveAttribute('data-status', 'running')
    await expect(card.locator('[data-stage="build"]')).toHaveAttribute(
      'data-stage-status',
      'running',
    )
    await expect(card.locator('[data-stage="test"]')).toHaveAttribute(
      'data-stage-status',
      'running',
      { timeout: 10_000 },
    )
    await expect(card).toHaveAttribute('data-status', 'succeeded', { timeout: 30_000 })
    for (const stage of ['build', 'test', 'migrate', 'release']) {
      await expect(card.locator(`[data-stage="${stage}"]`)).toHaveAttribute(
        'data-stage-status',
        'succeeded',
      )
    }
    await turnSettled(page)
    await expect(assistantText(page).last()).toContainText('Released v1.5.0-rc.1 to staging.')

    // "The approval response strictly precedes the first progress part": the
    // first preliminary result only ever arrives on the resumed request.
    const events = await stream.events()
    const [call] = await stream.calls()
    const asked = events.findIndex((event) => event.type === 'tool-approval-request')
    const firstProgress = events.findIndex(
      (event) => event.type === 'tool-output-available' && event.toolCallId === call?.id,
    )
    expect(call).toMatchObject({
      name: 'run_deployment',
      input: { environment: 'staging', version: 'v1.5.0-rc.1' },
    })
    expect(firstProgress).toBeGreaterThan(asked)
    expect(
      events.filter((event) => event.type === 'tool-output-available' && event.preliminary),
    ).not.toHaveLength(0)

    const stored = (await storedWorkspace(request)).deployments.find(
      (deployment) => deployment.version === 'v1.5.0-rc.1',
    )
    expect(stored?.status).toBe('succeeded')
  })

  test('C2: cancelled during "test", it settles as cancelled with nothing running', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000)
    await openBoard(page)
    await send(page, 'Deploy v1.5.0-rc.1 to staging.')
    await page.getByTestId('approval-card').getByTestId('approval-approve').click()

    // Cancel during the stage the variant names, not whenever the card appears.
    const card = page.getByTestId('deployment-progress')
    await expect(card.locator('[data-stage="test"]')).toHaveAttribute(
      'data-stage-status',
      'running',
      { timeout: 10_000 },
    )
    await card.getByTestId('deployment-cancel').click()

    // "In C2, the final deployment status is 'cancelled' (not 'failed', not
    // 'succeeded')" — on the card and in the store, which can disagree.
    await expect(card).toHaveAttribute('data-status', 'cancelled', { timeout: 30_000 })
    await expect(card.locator('[data-stage="build"]')).toHaveAttribute(
      'data-stage-status',
      'succeeded',
    )
    await expect(card.locator('[data-stage-status="running"]')).toHaveCount(0)
    const stored = (await storedWorkspace(request)).deployments.find(
      (deployment) => deployment.version === 'v1.5.0-rc.1',
    )
    expect(stored?.status).toBe('cancelled')
    expect(stored?.stages.map((stage) => stage.status)).toEqual([
      'succeeded',
      'skipped',
      'skipped',
      'skipped',
    ])
  })
})

test.describe('S-D — generative burndown chart from natural language', () => {
  test('draws the series once and narrates it from the data', async ({ page }) => {
    const stream = recordStream(page)
    await openBoard(page)
    await send(page, 'Is Sprint 12 on track? Show me the burndown.')

    const chart = page.getByTestId('burndown-chart')
    await expect(chart).toContainText('23 of 31 points left')
    await expect(chart).toContainText('Remaining')
    await expect(chart).toContainText('Ideal')
    await turnSettled(page)

    // "Narration matches the data (behind ideal, not 'on track') and calls
    // out DS-11" — read from the agent's message, not the user's question.
    const answer = assistantText(page).last()
    await expect(answer).toContainText('8 of 31 points done')
    await expect(answer).toContainText('behind the ideal line')
    await expect(answer).toContainText('DS-11')
    await expect(answer).not.toContainText(/\bon track\b/i)

    // "get_burndown is called exactly once." The series carries no issue data,
    // so DS-11 is grounded in a second read of the blockers, not invented.
    const calls = await stream.calls()
    expect(calls).toEqual([
      expect.objectContaining({ name: 'get_burndown', input: { sprintId: 'sprint-12' } }),
      expect.objectContaining({
        name: 'list_issues',
        input: expect.objectContaining({ sprintId: 'sprint-12', status: 'blocked' }),
      }),
    ])
    const series = (await stream.outputs()).get(calls[0]?.id ?? '') as {
      data: { committedPoints: number; days: unknown[] }
    }
    expect(series.data.committedPoints).toBe(31)
    expect(series.data.days).toHaveLength(14)
  })
})

test.describe('S-E — error recovery', () => {
  test('a missing key fails as a typed error, and the fix goes behind a fresh approval', async ({
    page,
    request,
  }) => {
    const stream = recordStream(page)
    await openBoard(page)
    await send(page, 'Mark DS-42 as done — the billing export shipped this morning.')

    const cards = page.getByTestId('approval-card')
    await expect(cards).toHaveCount(1)
    await expect(cards.first().getByTestId('approval-headline')).toContainText('DS-42')
    await cards.first().getByTestId('approval-approve').click()

    // "The error is a typed envelope (ISSUE_NOT_FOUND) rendered as an
    // ErrorCard, not a crash or silent failure."
    await expect(page.getByTestId('error-card')).toContainText('ISSUE_NOT_FOUND')
    // Said once, in the board's words: the card records it briefly, and the
    // ErrorCard explains without the api's model-facing hint.
    await expect(page.getByTestId('error-card')).toContainText('No issue DS-42 on the board.')
    await expect(page.getByTestId('error-card')).not.toContainText('search_issues')
    await expect(cards.first().getByTestId('approval-outcome')).toContainText(
      /Approved by you at \d\d.\d\d — not applied \(ISSUE_NOT_FOUND\)\./,
    )

    // Step 4: a search for what was meant, best match first.
    const table = page.getByTestId('issue-table')
    await expect(table.locator('[data-issue-key]').first()).toHaveAttribute(
      'data-issue-key',
      'DS-7',
    )
    await turnSettled(page)
    // One sentence on the failure, then the question that offers the fix.
    await expect(assistantText(page).last()).toContainText(
      "DS-42 isn't on the board, so nothing changed. Did you mean DS-7, “Billing export CSV download”?",
    )

    // Steps 6–8: confirming raises a second card; the first is not reused.
    await send(page, 'Yes, that one.')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(1).getByTestId('approval-headline')).toContainText('DS-7')
    await expect(page.getByTestId('chat-input')).toBeDisabled()
    expect(
      (await storedWorkspace(request)).issues.find((issue) => issue.key === 'DS-7')?.status,
    ).toBe('in_review')
    await cards.nth(1).getByTestId('approval-approve').click()
    await expect(
      page.getByTestId('board-column-done').locator('[data-issue-key="DS-7"]'),
    ).toBeVisible()

    // "After the error, the next tool call is search_issues", and the two
    // writes went through two separate approvals.
    const calls = await stream.calls()
    expect(calls.map((call) => [call.name, call.input])).toEqual([
      ['update_issue_status', { issueKey: 'DS-42', status: 'done' }],
      ['search_issues', expect.objectContaining({ query: 'billing export' })],
      ['update_issue_status', { issueKey: 'DS-7', status: 'done' }],
    ])
    const approvals = (await stream.events()).filter(
      (event) => event.type === 'tool-approval-request',
    )
    expect(new Set(approvals.map((event) => event.approvalId)).size).toBe(2)

    // "Final workspace state: DS-7 is done; no issue DS-42 exists."
    const stored = await storedWorkspace(request)
    expect(stored.issues.find((issue) => issue.key === 'DS-7')?.status).toBe('done')
    expect(stored.issues.some((issue) => issue.key === 'DS-42')).toBe(false)
  })
})

test.describe('S-F — an external MCP host operates the same workspace', () => {
  /** Unwraps the `{ ok, data | error }` envelope each tool returns as text. */
  function envelope(result: Awaited<ReturnType<Client['callTool']>>) {
    const [first] = result.content as Array<{ type: string; text: string }>
    return JSON.parse(first?.text ?? 'null') as {
      ok: boolean
      data?: { issue: { key: string; title: string; status: string; sprintId: string | null } }
      error?: { code: string }
    }
  }

  test('a write made over MCP lands on the board the SPA shows', async ({ page, request }) => {
    // The host side, with the stock MCP SDK client and nothing DevSprint-specific:
    // if this works, any Streamable HTTP host does the same.
    const client = new Client({ name: 'e2e-external-host', version: '1.0.0' })
    // The SDK's own transport is not exactOptionalPropertyTypes-clean against
    // its own interface; the cast changes no runtime behaviour.
    await client.connect(new StreamableHTTPClientTransport(new URL(`${MCP}/mcp`)) as Transport)
    try {
      // The SPA is already open when the write happens (precondition).
      await openBoard(page)
      await expect(page.locator('[data-issue-key="DS-14"]')).toHaveCount(0)

      // "The MCP server exposes exactly" the four issue tools.
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'create_issue',
        'list_issues',
        'search_issues',
        'update_issue_status',
      ])

      // "Server-side input validation runs even though the approval UX
      // belongs to the host": a write the schema refuses is an MCP error
      // result, and it stores nothing.
      const invalid = await client.callTool({
        name: 'create_issue',
        arguments: { title: '', type: 'feature', priority: 'medium' },
      })
      expect(invalid.isError).toBe(true)
      expect(JSON.stringify(invalid.content)).toContain('Input validation error')
      expect((await storedWorkspace(request)).issues).toHaveLength(13)

      // Steps 4–5: "create_issue produces DS-14 with sprintId: null and the
      // exact title."
      const created = envelope(
        await client.callTool({
          name: 'create_issue',
          arguments: {
            title: 'Add CSV export progress indicator',
            type: 'feature',
            priority: 'medium',
            sprintId: null,
          },
        }),
      )
      expect(created.ok).toBe(true)
      expect(created.data?.issue).toMatchObject({
        key: 'DS-14',
        title: 'Add CSV export progress indicator',
        sprintId: null,
      })

      // Step 6, read back through the *api* — so this fails if the two
      // Workers ever stop sharing one Durable Object.
      const stored = (await storedWorkspace(request)).issues.find((issue) => issue.key === 'DS-14')
      expect(stored?.sprintId).toBeNull()

      // The SPA does not poll (ADR-0014), so the operator's switch is a reload.
      await page.reload()
      const backlogCard = page.getByTestId('board-backlog').locator('[data-issue-key="DS-14"]')
      await expect(backlogCard).toContainText('Add CSV export progress indicator')
      await expect(backlogCard.getByTestId('issue-status')).toHaveText('Todo')

      // Step 7: the follow-up move, visible on the backlog card.
      const moved = envelope(
        await client.callTool({
          name: 'update_issue_status',
          arguments: { issueKey: 'DS-14', status: 'in_progress' },
        }),
      )
      expect(moved.ok).toBe(true)
      await page.reload()
      await expect(backlogCard.getByTestId('issue-status')).toHaveText('In progress')
    } finally {
      await client.close()
    }
  })
})
