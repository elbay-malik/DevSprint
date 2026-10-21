import { expect, test } from '@playwright/test'
import { resetBoard } from './support'

// Approved writes mutate the Worker's workspace, so every test starts from the
// seed rather than inheriting whatever an earlier run left behind. The six
// demo scenarios themselves, end to end, are in scenarios.spec.ts.
test.beforeEach(async ({ request }) => {
  await resetBoard(request)
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

test('the chat follows new tokens, and lets go when you scroll up', async ({ page }) => {
  await page.goto('/')

  // wireframes.md §6 documented this as shipped behaviour; it was never built,
  // so a streamed answer arrived below the fold and the pane never moved. A
  // compound question is used rather than a write, because the composer is
  // deliberately locked while approval cards are outstanding.
  const viewport = page.locator('[data-slot="scroll-area-viewport"]')
  const ask = async (text: string) => {
    await page.getByTestId('chat-input').fill(text)
    await page.getByTestId('chat-input').press('Enter')
  }

  await ask('Summarize Sprint 12 and draft release notes for v1.5.0.')
  await expect(page.getByTestId('release-notes-diff')).toBeVisible()
  // Settled, so the next step is not racing the tail of this turn.
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()

  // Followed to the bottom on its own, and actually moved to get there.
  await expect
    .poll(
      async () => viewport.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 24),
      { timeout: 10_000 },
    )
    .toBe(true)
  expect(await viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  // Scrolling up releases the anchor, so reading back through a transcript is
  // not fought by every delta that arrives.
  await viewport.evaluate((el) => {
    el.scrollTop = 0
  })

  // A second turn with a distinctive answer, so this waits for the stream to
  // have actually rendered rather than for a fixed number of milliseconds —
  // under load a sleep either races the tokens or hides the bug.
  await ask('Search for DS-42')
  await expect(page.getByTestId('chat-pane')).toContainText('No matching issues')
  expect(await viewport.evaluate((el) => el.scrollTop)).toBeLessThan(100)
})

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
  // Back where the seed has it, not merely gone from Done.
  await expect(doneColumn).not.toContainText('DS-7')
  await expect(
    page.getByTestId('board-column-in_review').locator('[data-issue-key="DS-7"]'),
  ).toBeVisible()
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

test('a search renders the compact table with match scores', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('chat-input').fill('Find the billing export issue')
  await page.getByTestId('chat-input').press('Enter')

  const table = page.getByTestId('issue-table')
  await expect(table).toBeVisible()
  await expect(table).toContainText('DS-7')
  // The compact variant carries the match score instead of points.
  await expect(table).toContainText('Score')
})
