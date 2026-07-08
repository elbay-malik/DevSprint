import { expect, test } from '@playwright/test'

test('two-pane shell renders with board and chat', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/DevSprint/)
  await expect(page.getByTestId('workspace-pane')).toBeVisible()
  await expect(page.getByTestId('chat-pane')).toBeVisible()
  expect(await page.getByTestId('issue-card').count()).toBeGreaterThan(0)
  await expect(page.getByTestId('chat-input')).toBeVisible()
})
