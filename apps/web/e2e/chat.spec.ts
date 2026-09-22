import { expect, test } from '@playwright/test'

// Approved writes mutate the Worker's workspace, so every test starts from the
// seed rather than inheriting whatever an earlier run left behind.
test.beforeEach(async ({ request }) => {
  await request.post('http://localhost:8787/api/workspace/reset')
})

/**
 * The Phase 3 acceptance path, end to end through both servers: the board is
 * served by the Worker, and the composer's answer is grounded in a real tool
 * call against the seed. The full six-scenario suite is Phase 13.
 */
test('the board hydrates from the api', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
})

test('the agent sources its issue tools over MCP, not the local fallback', async ({ page }) => {
  await page.goto('/')

  // The whole point of the refactor: the in-app agent and an external host call
  // one implementation. A silent fallback would make this suite pass while
  // proving nothing, so the answer says which source served the turn.
  const response = page.waitForResponse((res) => res.url().includes('/api/chat'))
  await page.getByTestId('chat-input').fill('Show me the blocked issues')
  await page.getByTestId('chat-input').press('Enter')

  expect((await response).headers()['x-devsprint-tools']).toBe('mcp')
  await expect(page.getByTestId('chat-pane')).toContainText('DS-11')
})

test('a sprint question is answered by a grounded tool call', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('chat-input').fill('How many open issues are in the current sprint?')
  await page.getByTestId('chat-input').press('Enter')

  const chip = page.getByTestId('tool-call-chip')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('get_sprint_status')

  // Values come from the seed (31 committed, 8 done, DS-11 blocked), not the model.
  const chat = page.getByTestId('chat-pane')
  await expect(chat).toContainText('5 open issues')
  await expect(chat).toContainText('23 of 31 points remaining')
  await expect(chat).toContainText('DS-11')
})

test('an issue key that names nothing gets an honest empty answer', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('chat-input').fill('Search for DS-42')
  await page.getByTestId('chat-input').press('Enter')

  // search_issues has had its own card since Phase 7 (ToolResultCard.test.ts
  // covers the empty case directly) — the chip is only visible in the
  // fleeting instant before the result arrives, so asserting on it here raced
  // the render and failed whenever nothing slowed the page down enough to
  // catch that instant.
  const table = page.getByTestId('issue-table')
  await expect(table).toBeVisible()
  await expect(table).toContainText('No matching issues')
  await expect(page.getByTestId('chat-pane')).toContainText('No matching issues')
})

test('a compound question chains several tools in one turn', async ({ page }) => {
  await page.goto('/')

  await page
    .getByTestId('chat-input')
    .fill('Summarize Sprint 12 and draft release notes for v1.5.0.')
  await page.getByTestId('chat-input').press('Enter')

  // Two steps, rendered as the registry says: sprint status keeps the chip,
  // the issue list gets its table. get_sprint_status runs first and always
  // keeps its chip, but list_issues briefly has one too before it resolves
  // into the table — `.first()` is what keeps this correct regardless of
  // whether that second, transient chip is still on screen when this runs.
  await expect(page.getByTestId('tool-call-chip').first()).toContainText('get_sprint_status')
  await expect(page.getByTestId('issue-table')).toBeVisible()

  // The answer draws on both steps: sprint health, then the work that shipped.
  const chat = page.getByTestId('chat-pane')
  await expect(chat).toContainText('23 of 31 points remaining')
  await expect(chat).toContainText('DS-5')
})

test('the stop button ends the turn', async ({ page }) => {
  await page.goto('/')

  await page
    .getByTestId('chat-input')
    .fill('Summarize Sprint 12 and draft release notes for v1.5.0.')
  await page.getByTestId('chat-input').press('Enter')

  // Stop once the first tool call is in flight, so there is a turn to interrupt.
  await expect(page.getByTestId('tool-call-chip').first()).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()

  // Left alone this turn chains a second tool and answers in about 1.5s, so if
  // the click did nothing both would show up in the window below. Their absence
  // is what distinguishes an aborted turn from one that simply finished.
  await page.waitForTimeout(3000)
  await expect(page.getByTestId('chat-pane')).not.toContainText('23 of 31 points remaining')
})

test('the chat still works after a turn is stopped', async ({ page }) => {
  await page.goto('/')

  await page
    .getByTestId('chat-input')
    .fill('Summarize Sprint 12 and draft release notes for v1.5.0.')
  await page.getByTestId('chat-input').press('Enter')
  // Wait for a call to actually be in flight, so the stop really does leave a
  // dangling tool call — that is the precondition this test exists to cover.
  await expect(page.getByTestId('tool-call-chip').first()).toBeVisible()
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()

  // The stopped turn leaves a tool call with no result in the history; the next
  // question has to survive that rather than wedging the conversation.
  await page.getByTestId('chat-input').fill('How many open issues are in the current sprint?')
  await page.getByTestId('chat-input').press('Enter')

  await expect(page.getByTestId('chat-pane')).toContainText('5 open issues')
})

const CLOSE_OUT =
  "We're closing Sprint 12 today — mark every remaining open issue in the sprint as done."

test('the header resets the board and switches theme', async ({ page }) => {
  await page.goto('/')

  // Both controls are documented in wireframes.md §1, and both were missing.
  // Reset in particular is what apps/api/README.md and ADR-0014 point at when
  // they justify leaving the reset route ungated.
  await expect(page.getByTestId('app-header')).toBeVisible()

  // Dark styles hang off a `.dark` class that nothing used to set, so the
  // whole palette was unreachable. Toggling must actually put it on the root.
  // A fresh context starts on `system`, and the cycle is light → dark → system,
  // so two clicks lands on an explicit dark regardless of the OS preference.
  await page.getByTestId('theme-toggle').click()
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  // A real write, then Reset, then the board is back to the seed. Every card
  // has to be answered before the turn settles, and the board only re-reads
  // the workspace once it does — so approving just one proves nothing.
  await page.getByTestId('chat-input').fill(CLOSE_OUT)
  await page.getByTestId('chat-input').press('Enter')
  const cards = page.getByTestId('approval-card')
  await expect(cards).toHaveCount(5)
  for (let index = 0; index < 5; index += 1) {
    await cards.nth(index).getByTestId('approval-approve').click()
  }

  const doneColumn = page.getByTestId('board-column-done')
  await expect(doneColumn).toContainText('DS-7')

  await page.getByTestId('reset-demo').click()
  await expect(doneColumn).not.toContainText('DS-7')
})

test('every write is gated, one card per issue, and a denial is respected', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)

  await page.getByTestId('chat-input').fill(CLOSE_OUT)
  await page.getByTestId('chat-input').press('Enter')

  // One gate per mutation — never a single card covering all five.
  const cards = page.getByTestId('approval-card')
  await expect(cards).toHaveCount(5)
  await expect(cards.first()).toContainText('update_issue_status')
  await expect(page.getByTestId('approval-headline').first()).toContainText('DS-7')

  // Nothing has run yet: the board still shows DS-7 outside the Done column.
  const doneColumn = page.getByTestId('board-column-done')
  await expect(page.getByTestId('workspace-pane')).toContainText('DS-7')
  await expect(doneColumn).not.toContainText('DS-7')

  // Typing is refused while decisions are outstanding, otherwise answering the
  // cards would silently do nothing.
  await expect(page.getByTestId('chat-input')).toBeDisabled()

  // Approve the first four, deny DS-11 with a reason (scenario S-B step 9).
  for (let index = 0; index < 4; index += 1) {
    await cards.nth(index).getByTestId('approval-approve').click()
  }
  const denied = cards.nth(4)
  await denied.getByTestId('approval-reason').fill('Still blocked on vendor sandbox')
  await denied.getByTestId('approval-deny').click()

  // The turn resumes on its own once every card is answered.
  const chat = page.getByTestId('chat-pane')
  await expect(chat).toContainText('DS-7 moved in_review → done')
  await expect(chat).toContainText('DS-11 was not approved')
  await expect(chat).toContainText('Still blocked on vendor sandbox')

  // The card keeps the decision as an audit record.
  await expect(denied.getByTestId('approval-outcome')).toContainText('Denied')
  await expect(cards.first().getByTestId('approval-outcome')).toContainText('Approved by you')

  // The composer is usable again.
  await expect(page.getByTestId('chat-input')).toBeEnabled()

  // And the board reflects the approved writes without a reload: DS-7 has moved
  // to Done, while the denied DS-11 has not.
  await expect(doneColumn).toContainText('DS-7')
  await expect(doneColumn).not.toContainText('DS-11')
})

test('tool results render as cards, not raw JSON', async ({ page }) => {
  await page.goto('/')

  await page
    .getByTestId('chat-input')
    .fill('Is Sprint 12 on track? Show me the burndown and the blocked issues.')
  await page.getByTestId('chat-input').press('Enter')

  // The burndown reads at the demo clock, not at the last day of the sprint.
  const chart = page.getByTestId('burndown-chart')
  await expect(chart).toBeVisible()
  await expect(chart).toContainText('23 of 31 points left')
  await expect(chart).toContainText('Remaining')
  await expect(chart).toContainText('Ideal')

  const table = page.getByTestId('issue-table')
  await expect(table).toBeVisible()
  await expect(table).toContainText('DS-11')
  await expect(table).toContainText('Blocked')

  // Those two tools no longer fall back to the chip.
  await expect(page.getByTestId('tool-call-chip')).toHaveCount(0)
})

test('a search renders the compact table and a failure renders an error', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('chat-input').fill('Find the billing export issue')
  await page.getByTestId('chat-input').press('Enter')

  const table = page.getByTestId('issue-table')
  await expect(table).toBeVisible()
  await expect(table).toContainText('DS-7')
  // The compact variant carries the match score instead of points.
  await expect(table).toContainText('Score')
})

test('a deployment is approved, then streams its stages to done (S-C)', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('chat-input').fill('Deploy v1.5.0-rc.1 to staging.')
  await page.getByTestId('chat-input').press('Enter')

  // Nothing runs before the gate is answered.
  const approval = page.getByTestId('approval-card')
  await expect(approval).toBeVisible()
  await expect(approval).toContainText('run_deployment')
  await expect(page.getByTestId('deployment-progress')).toHaveCount(0)

  await approval.getByTestId('approval-approve').click()

  const card = page.getByTestId('deployment-progress')
  await expect(card).toBeVisible()
  // Every stage is named, so the reader sees the shape of the run, not a bar.
  for (const stage of ['build', 'test', 'migrate', 'release']) {
    await expect(card.locator(`[data-stage="${stage}"]`)).toBeVisible()
  }

  // Asserted while the run is still going, because the card is re-read from the
  // board once the turn settles. Without this, a card that never moved and only
  // rendered the final state would pass every other assertion here.
  await expect(card.locator('[data-stage="build"]')).toHaveAttribute('data-stage-status', 'running')
  await expect(card).toHaveAttribute('data-status', 'running')
  await expect(card.locator('[data-stage="release"]')).toHaveAttribute(
    'data-stage-status',
    'pending',
  )
  // Then it advances on its own, without a reload or a new message.
  await expect(card.locator('[data-stage="build"]')).toHaveAttribute(
    'data-stage-status',
    'succeeded',
    { timeout: 15_000 },
  )

  await expect(card).toHaveAttribute('data-status', 'succeeded', { timeout: 30_000 })
  await expect(card.locator('[data-stage="release"]')).toHaveAttribute(
    'data-stage-status',
    'succeeded',
  )
})

test('cancelling mid-run leaves a cancelled deployment (S-C variant C2)', async ({
  page,
  request,
}) => {
  await page.goto('/')

  await page.getByTestId('chat-input').fill('Deploy v1.6.0 to staging.')
  await page.getByTestId('chat-input').press('Enter')
  await page.getByTestId('approval-card').getByTestId('approval-approve').click()

  const card = page.getByTestId('deployment-progress')
  await expect(card).toBeVisible()
  await card.getByTestId('deployment-cancel').click()

  // Cancelled, not failed, and not left mid-flight.
  await expect(card).toHaveAttribute('data-status', 'cancelled', { timeout: 30_000 })
  await expect(card.locator('[data-stage-status="running"]')).toHaveCount(0)

  // And the workspace agrees with what the card claims. This is the half that
  // is easy to get wrong: the run carries on server-side while the card says it
  // stopped, so assert against the stored deployment rather than the pixels.
  const stored = await (await request.get('http://localhost:8787/api/workspace')).json()
  const deployed = stored.deployments.find((entry: { version: string }) => {
    return entry.version === 'v1.6.0'
  })
  expect(deployed.status).toBe('cancelled')
  expect(deployed.stages.every((stage: { status: string }) => stage.status !== 'running')).toBe(
    true,
  )
  // The run stopped where it got to instead of quietly finishing.
  expect(deployed.stages.at(-1).status).toBe('skipped')
})
