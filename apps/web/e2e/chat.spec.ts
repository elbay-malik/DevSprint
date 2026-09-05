import { expect, test } from '@playwright/test'

/**
 * The Phase 3 acceptance path, end to end through both servers: the board is
 * served by the Worker, and the composer's answer is grounded in a real tool
 * call against the seed. The full six-scenario suite is Phase 13.
 */
test('the board hydrates from the api', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
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
