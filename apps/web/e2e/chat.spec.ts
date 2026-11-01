import { expect, test } from '@playwright/test'
import { API, MCP, recordStream, resetBoard, send, storedWorkspace, turnSettled } from './support'

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

// The caption compares the Worker's board with the SPA's copy of the seed, so
// this is the check that those two really do start out equal.
test('the board says how far it has come since the last reset', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
  const caption = page.getByTestId('workspace-changes')
  await expect(caption).toHaveCount(0)

  await send(page, 'Mark DS-7 as done.')
  await page.getByTestId('approval-card').getByTestId('approval-approve').click()
  await turnSettled(page)
  await expect(caption).toContainText('1 change since the last reset')

  // A new visitor arriving on the same board sees it straight away.
  await page.reload()
  await expect(caption).toContainText('1 change since the last reset')

  await resetBoard(request)
  await page.reload()
  await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
  await expect(caption).toHaveCount(0)
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
  await page.getByTestId('chat-stop').click()
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
  await page.getByTestId('chat-stop').click()
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

  // A new request follows again (ChatPane.vue: answering the last approval
  // card is one), so the anchor is let go mid-stream, the way a reader does
  // it: the second turn is under way, then they scroll up.
  await ask('Summarize Sprint 12 and draft release notes for v1.5.0.')
  await expect(page.getByTestId('chat-stop')).toBeVisible()
  // The scroll event is sent with the move, so a delta landing before the
  // browser's own one cannot read as the reader still being at the bottom.
  const heightWhenReleased = await viewport.evaluate((el) => {
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
    return el.scrollHeight
  })

  // Waits for the stream to have actually rendered rather than for a fixed
  // number of milliseconds: under load a sleep either races the tokens or
  // hides the bug.
  await expect(page.getByTestId('release-notes-diff')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  // It grew below the reader, and did not pull them down to it.
  expect(await viewport.evaluate((el) => el.scrollHeight)).toBeGreaterThan(heightWhenReleased)
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

  // The board is shared, so Reset asks first, and only Confirm resets.
  await page.getByTestId('reset-demo').click()
  await expect(page.getByTestId('reset-demo-question')).toContainText('Reset for everyone?')
  await expect(page.getByTestId('reset-demo-confirm')).toBeFocused()
  await expect(doneColumn).toContainText('DS-7')
  await page.getByTestId('reset-demo-confirm').click()
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

test('a search renders the compact table with how well each issue matched', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('chat-input').fill('Find the billing export issue')
  await page.getByTestId('chat-input').press('Enter')

  const table = page.getByTestId('issue-table')
  await expect(table).toBeVisible()
  await expect(table).toContainText('DS-7')
  // The compact variant says how well each issue matched instead of points.
  await expect(table).toContainText('Match')
  await expect(table.locator('[data-issue-key="DS-7"]')).toContainText('Strong')
})

test('the empty transcript runs a scenario in one click, then gives way', async ({ page }) => {
  await page.goto('/')
  const suggestions = page.getByRole('group', { name: 'Suggested requests' })
  await expect(suggestions.getByRole('button')).toHaveCount(5)
  // The same board, offered to outside clients by its address.
  await expect(page.getByTestId('mcp-endpoint')).toContainText(`${MCP}/mcp`)

  // By keyboard, as anyone can reach it.
  await suggestions.getByRole('button', { name: 'Is the sprint on track?' }).focus()
  await page.keyboard.press('Enter')

  await expect(page.locator('[data-role="user"]')).toHaveText(
    'Is Sprint 12 on track? Show me the burndown.',
  )
  await expect(page.getByTestId('burndown-chart')).toBeVisible()
  await expect(suggestions).toHaveCount(0)
  await expect(page.getByTestId('chat-input')).toBeFocused()
})

test('a draft typed while approvals are open is kept, and sent once they are answered', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page.getByTestId('chat-input').fill('Deploy v1.5.0-rc.1 to staging.')
  await page.getByTestId('chat-input').press('Enter')
  const card = page.getByTestId('approval-card')
  await expect(card).toHaveCount(1)

  const input = page.getByTestId('chat-input')
  await input.fill('How many open issues are in the current sprint?')
  // Enter does not send past an open card: it would orphan it.
  await input.press('Enter')
  await expect(page.locator('[data-role="user"]')).toHaveCount(1)
  await expect(page.getByTestId('composer-locked-hint')).toBeVisible()

  await card.getByTestId('approval-deny').click()
  await turnSettled(page)
  await expect(input).toHaveValue('How many open issues are in the current sprint?')
  await input.press('Enter')
  await expect(page.locator('[data-role="user"]')).toHaveCount(2)
  // The denied deploy never ran.
  expect((await storedWorkspace(request)).deployments.map((d) => d.version)).not.toContain(
    'v1.5.0-rc.1',
  )

  // Up in the empty composer brings the last prompt back, like a shell.
  await turnSettled(page)
  await input.press('ArrowUp')
  await expect(input).toHaveValue('How many open issues are in the current sprint?')
  await input.press('ArrowUp')
  await expect(input).toHaveValue('Deploy v1.5.0-rc.1 to staging.')
  await input.press('ArrowDown')
  await input.press('ArrowDown')
  await expect(input).toHaveValue('')
})

// S-B's close-out, decided the short way. The scenario spec keeps the per-card
// path its step table describes; this is the one press for the rest.
test('deny DS-11, then Approve remaining 4 answers each card on its own record', async ({
  page,
  request,
}) => {
  const stream = recordStream(page)
  await page.goto('/')
  await send(
    page,
    "We're closing Sprint 12 today — mark every remaining open issue in the sprint as done.",
  )
  const cards = page.getByTestId('approval-card')
  await expect(cards).toHaveCount(5)

  // While it is offered, Approve all is the message's one Ink: no card's
  // Approve is filled beside it.
  const all = page.getByTestId('approval-approve-all')
  await expect(all).toHaveText('Approve all 5')
  await expect(all).toHaveClass(/bg-primary/)
  // The turn ended on the header, so the press is one Tab away, and Enter on
  // the header itself approves nothing.
  const header = page.getByTestId('approval-group-header')
  await expect(header).toBeFocused()
  await expect(header).toHaveCSS('outline-style', 'solid')
  await expect(header).toHaveCSS('outline-width', '2px')
  await page.keyboard.press('Enter')
  await expect(all).toHaveText('Approve all 5')
  await page.keyboard.press('Tab')
  await expect(all).toBeFocused()
  for (const approve of await page.getByTestId('approval-approve').all()) {
    await expect(approve).not.toHaveClass(/bg-primary/)
  }

  const blocked = cards.nth(4)
  await expect(blocked.getByTestId('approval-headline')).toContainText('DS-11')
  await blocked.getByTestId('approval-reason').fill('Still blocked on vendor sandbox')
  await blocked.getByTestId('approval-deny').click()
  await expect(all).toHaveText('Approve remaining 4')
  await all.click()

  // One line for the press, then the turn resumes on its own.
  await expect(page.getByTestId('chat-status')).toContainText(
    /4 changes approved by you at \d\d.\d\d\./,
  )
  await turnSettled(page)
  await expect(all).toHaveCount(0)
  // And the writes it ran are said once more as one line, not four.
  await expect(page.getByTestId('chat-status')).toHaveText(
    /^4 changes approved by you at \d\d.\d\d — applied\. Copilot replied\.$/,
  )
  // Each card still carries its own record and its own from → to.
  for (const index of [0, 1, 2, 3]) {
    await expect(cards.nth(index).getByTestId('approval-outcome')).toHaveText(
      /^● Approved by you at \d\d.\d\d — applied\.$/,
    )
  }
  await expect(cards.first().getByTestId('approval-headline')).toHaveText('DS-7: In review → Done')
  await expect(page.locator('[data-role="assistant"]').last()).toContainText(
    '4 of the 5 issues are now Done.',
  )

  // Still five single-use approvals, four of which ran; DS-11 never moved.
  const events = await stream.events()
  expect(events.filter((event) => event.type === 'tool-approval-request')).toHaveLength(5)
  const calls = (await stream.calls()).filter((call) => call.name === 'update_issue_status')
  const outputs = await stream.outputs()
  expect(calls.filter((call) => outputs.has(call.id)).map((call) => call.input.issueKey)).toEqual([
    'DS-7',
    'DS-8',
    'DS-9',
    'DS-10',
  ])
  const stored = await storedWorkspace(request)
  for (const key of ['DS-7', 'DS-8', 'DS-9', 'DS-10']) {
    expect(stored.issues.find((issue) => issue.key === key)?.status).toBe('done')
  }
  expect(stored.issues.find((issue) => issue.key === 'DS-11')?.status).toBe('blocked')
})

test('an applied change can be undone once, and the board shows it back', async ({
  page,
  request,
}) => {
  const stream = recordStream(page)
  await page.goto('/')
  await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
  await send(page, 'Mark DS-7 as done.')
  const card = page.getByTestId('approval-card')
  await card.getByTestId('approval-approve').click()
  await turnSettled(page)
  await expect(
    page.getByTestId('board-column-done').locator('[data-issue-key="DS-7"]'),
  ).toBeVisible()

  const undo = card.getByTestId('approval-undo')
  await expect(undo).toHaveText('Undo')
  // A record's way back, never the region's Ink.
  await expect(undo).not.toHaveClass(/bg-primary/)
  await undo.click()

  const record = card.getByTestId('approval-undo-record')
  await expect(record).toHaveText(/^↶ Undone by you at \d\d.\d\d — DS-7 back to In review\.$/)
  await expect(page.getByTestId('chat-status')).toHaveText(
    /^Undone by you at \d\d.\d\d — DS-7 back to In review\.$/,
  )
  await expect(undo).toHaveCount(0)
  await expect(record).toBeFocused()
  // The approval's own record stays above it.
  await expect(card.getByTestId('approval-outcome')).toContainText('applied')
  await expect(
    page.getByTestId('board-column-in_review').locator('[data-issue-key="DS-7"]'),
  ).toBeVisible()
  expect(
    (await storedWorkspace(request)).issues.find((issue) => issue.key === 'DS-7')?.status,
  ).toBe('in_review')

  // One-shot on the server too: the same change id is refused the second time.
  const [write] = (await stream.calls()).filter((call) => call.name === 'update_issue_status')
  const output = (await stream.outputs()).get(write?.id ?? '') as { data?: { changeId?: string } }
  const again = await request.post(`${API}/api/workspace/undo`, {
    data: { changeId: output.data?.changeId },
  })
  expect(again.status()).toBe(409)
  expect((await again.json()).error.code).toBe('UNDO_CONFLICT')
})

test('an assignment is marked on the board, applied, and undone back to nobody', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
  await send(page, 'Assign DS-12 to Dana')
  const card = page.getByTestId('approval-card')
  // DS-12 sits in the backlog with nobody on it; the card says so in words.
  await expect(card.getByTestId('approval-headline')).toHaveText('DS-12: Unassigned → @dana')
  await expect(card.getByTestId('approval-tool')).toHaveText('assign_issue')

  // Pending, the card is marked where it stands: no move, just the hand-on.
  const issue = page.getByTestId('board-backlog').locator('[data-issue-key="DS-12"]')
  await expect(issue).toHaveAttribute('data-pending-assignee', '')
  await expect(issue).not.toHaveAttribute('data-pending-move', '')
  // The arrow is drawn; a screen reader hears "Awaiting approval to assign to @dana".
  await expect(issue.getByTestId('issue-pending-assignee')).toHaveText(
    '→ Awaiting approval to assign to @dana',
  )

  await card.getByTestId('approval-approve').click()
  await turnSettled(page)
  await expect(page.getByTestId('chat-pane')).toContainText('DS-12 is now assigned to @dana.')
  await expect(issue.getByTestId('issue-assignee')).toHaveText('@dana')
  await expect(issue.getByTestId('issue-pending-assignee')).toHaveCount(0)
  // The record keeps the change it was, after the board caught up.
  await expect(card.getByTestId('approval-headline')).toHaveText('DS-12: Unassigned → @dana')
  expect(
    (await storedWorkspace(request)).issues.find((stored) => stored.key === 'DS-12')?.assigneeId,
  ).toBe('u-dana')

  await card.getByTestId('approval-undo').click()
  const record = card.getByTestId('approval-undo-record')
  await expect(record).toHaveText(/^↶ Undone by you at \d\d.\d\d — DS-12 back to unassigned\.$/)
  await expect(page.getByTestId('chat-status')).toHaveText(
    /^Undone by you at \d\d.\d\d — DS-12 back to unassigned\.$/,
  )
  await expect(issue.getByTestId('issue-assignee')).toHaveCount(0)
  expect(
    (await storedWorkspace(request)).issues.find((stored) => stored.key === 'DS-12')?.assigneeId,
  ).toBeNull()
})
