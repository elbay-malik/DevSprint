import { expect, test } from '@playwright/test'

// A first visit: nothing stored, unlike every other spec.
test.use({ storageState: { cookies: [], origins: [] } })

test('a first visit shows the card without taking focus, and Close hides it for the visit', async ({
  page,
}) => {
  await page.goto('/')
  const guide = page.getByRole('complementary', { name: 'Try this' })
  await expect(guide).toBeVisible()
  await expect(guide.getByRole('listitem')).toHaveCount(4)
  await expect(guide.locator(':focus')).toHaveCount(0)

  await guide.getByRole('button', { name: 'Close' }).click()
  await expect(guide).toBeHidden()
  await expect(page.getByTestId('guide-open')).toBeFocused()

  await page.reload()
  await expect(guide).toBeVisible()
})

test('Don’t show again holds across visits, and Guide reopens it', async ({ page }) => {
  await page.goto('/')
  const guide = page.getByRole('complementary', { name: 'Try this' })
  await guide.getByRole('button', { name: 'Don’t show again' }).click()
  await expect(guide).toBeHidden()

  await page.reload()
  await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
  await expect(guide).toBeHidden()

  await page.getByTestId('guide-open').click()
  await expect(guide).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(guide).toBeHidden()
})

test('the card gives way once the visitor starts on step 1', async ({ page }) => {
  await page.goto('/')
  const guide = page.getByRole('complementary', { name: 'Try this' })
  await expect(guide).toBeVisible()
  await page.getByTestId('chat-input').focus()
  await expect(guide).toBeHidden()
})

test.describe('at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test('the card fits the width and leaves the header controls free', async ({ page }) => {
    await page.goto('/')
    const guide = page.getByRole('complementary', { name: 'Try this' })
    await expect(guide).toBeVisible()
    const box = await guide.boundingBox()
    const header = await page.getByTestId('app-header').boundingBox()
    expect(box && header).toBeTruthy()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(360)
    expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
    // No sideways scroll from the card.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)

    await page.getByTestId('jump-to-copilot').click()
    await expect(guide).toBeHidden()
  })
})
