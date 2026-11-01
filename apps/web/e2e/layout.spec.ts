import { utimesSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test('two-pane shell renders with board and chat', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/DevSprint/)
  await expect(page.getByTestId('workspace-pane')).toBeVisible()
  await expect(page.getByTestId('workspace-source')).toBeVisible()
  await expect(page.getByTestId('chat-pane')).toBeVisible()
  expect(await page.getByTestId('issue-card').count()).toBeGreaterThan(0)
  await expect(page.getByTestId('chat-input')).toBeVisible()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the header points down to the copilot', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
    // Below lg the copilot starts under the whole board.
    await expect(page.getByTestId('chat-input')).not.toBeInViewport()

    await page.getByTestId('jump-to-copilot').click()
    await expect(page.getByTestId('chat-input')).toBeFocused()
    await expect(page.getByTestId('chat-input')).toBeInViewport()
  })
})

test('the copilot jump is gone once both panes share the view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('jump-to-copilot')).toBeHidden()
})

/**
 * Only the file's time changes, which is enough: Tailwind scans this file, so with
 * HMR on, Vite reloads the page within a moment. That once failed a deployment
 * test when a commit landed during a run. The wait is how long a reload would take
 * to show. A reused `pnpm dev` has HMR on, so it fails here too (e2e/servers.ts).
 */
test('a file changing during a run leaves the page alone', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    ;(window as Window & { sameDocument?: boolean }).sameDocument = true
  })

  const now = new Date()
  utimesSync(new URL('../playwright.config.ts', import.meta.url), now, now)
  await page.waitForTimeout(2_000)

  const sameDocument = await page.evaluate(
    () => (window as Window & { sameDocument?: boolean }).sameDocument,
  )
  expect(sameDocument, 'the page reloaded when a file changed').toBe(true)
})
