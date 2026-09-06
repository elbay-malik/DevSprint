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

  await expect(page.getByTestId('tool-call-chip')).toContainText('search_issues')
  await expect(page.getByTestId('chat-pane')).toContainText('No matching issues')
})

test('a compound question chains several tools in one turn', async ({ page }) => {
  await page.goto('/')

  await page
    .getByTestId('chat-input')
    .fill('Summarize Sprint 12 and draft release notes for v1.5.0.')
  await page.getByTestId('chat-input').press('Enter')

  const chips = page.getByTestId('tool-call-chip')
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(0)).toContainText('get_sprint_status')
  await expect(chips.nth(1)).toContainText('list_issues')

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
