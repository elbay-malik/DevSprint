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
