import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { resetBoard } from './support'

/**
 * Lighthouse only ever sees the first paint — an empty transcript — so its
 * accessibility score says nothing about the cards, gates and charts that are
 * the actual product. These drive the scripted model into each of those states
 * and audit what is on screen there, in both themes, since the dark palette is
 * a separate set of colour pairs that can fail contrast on its own.
 */
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const CLOSE_OUT =
  "We're closing Sprint 12 today — mark every remaining open issue in the sprint as done."

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
  // Rule ids and the offending selectors, so a failure reads without a rerun.
  const summary = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))
  expect(summary).toEqual([])
}

async function send(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-input').press('Enter')
}

test.beforeEach(async ({ request }) => {
  await resetBoard(request)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme })

    test('the empty shell', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
      // The theme follows the emulated OS preference; if it did not, the dark
      // half of this file would quietly audit the light palette twice.
      const root = page.locator('html')
      await (colorScheme === 'dark'
        ? expect(root).toHaveClass(/dark/)
        : expect(root).not.toHaveClass(/dark/))
      await expectNoViolations(page)
    })

    test('the first-visit guide', async ({ page, context }) => {
      await context.clearCookies()
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
      await expect(page.getByTestId('guide')).toBeVisible()
      await expectNoViolations(page)
    })

    test('a burndown chart and an issue table in the transcript', async ({ page }) => {
      await page.goto('/')
      await send(page, 'Is Sprint 12 on track? Show me the burndown and the blocked issues.')
      await expect(page.getByTestId('burndown-chart')).toBeVisible()
      await expect(page.getByTestId('issue-table')).toBeVisible()
      await expect(page.getByTestId('chat-input')).toBeEnabled()
      await expectNoViolations(page)
    })

    test('release notes and a tool chip', async ({ page }) => {
      await page.goto('/')
      await send(page, 'Summarize Sprint 12 and draft release notes for v1.5.0.')
      await expect(page.getByTestId('tool-call-chip').first()).toBeVisible()
      await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout: 15_000 })
      await expectNoViolations(page)
    })

    test('a pending save with the release notes it would store', async ({ page }) => {
      await page.goto('/')
      await send(page, 'Summarize Sprint 12 and draft release notes for v1.5.0.')
      await expect(page.getByTestId('tool-call-chip').first()).toBeVisible()
      await expect(page.getByTestId('chat-input')).toBeEnabled({ timeout: 15_000 })
      await send(page, 'Looks good, save it.')
      const body = page.getByTestId('approval-card').getByTestId('approval-body')
      await expect(body).toContainText('v1.5.0')
      // Line by line, as it would be stored, so text set apart on its own lines stays apart.
      await expect(body).toHaveCSS('white-space', 'pre-wrap')
      await expect(page.getByTestId('approval-body-more')).toHaveCount(0)
      await expectNoViolations(page)

      // The scripted draft fits. A real one scrolls, which is when axe asks for
      // the tab stop, so this audits the box as it would be with one.
      await body.evaluate((element) => {
        element.textContent = 'A line of release notes.\n'.repeat(40)
      })
      expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
      )
      await expect(page.getByTestId('approval-body-more')).toBeVisible()
      await expectNoViolations(page)
    })

    test('pending approval gates, then their recorded outcomes', async ({ page }) => {
      await page.goto('/')
      await send(page, CLOSE_OUT)
      const cards = page.getByTestId('approval-card')
      await expect(cards).toHaveCount(5)
      await expectNoViolations(page)

      for (let index = 0; index < 4; index += 1) {
        await cards.nth(index).getByTestId('approval-approve').click()
      }
      await cards.nth(4).getByTestId('approval-deny').click()
      await expect(cards.nth(4).getByTestId('approval-outcome')).toContainText('Denied')
      await expect(page.getByTestId('chat-input')).toBeEnabled()
      await expectNoViolations(page)
    })

    test('an applied change with its Undo, then the undone record', async ({ page }) => {
      await page.goto('/')
      await send(page, 'Mark DS-7 as done.')
      const card = page.getByTestId('approval-card')
      await card.getByTestId('approval-approve').click()
      await expect(card.getByTestId('approval-undo')).toBeVisible()
      await expect(page.getByTestId('chat-input')).toBeEnabled()
      await expectNoViolations(page)

      await card.getByTestId('approval-undo').click()
      await expect(card.getByTestId('approval-undo-record')).toBeVisible()
      await expectNoViolations(page)
    })

    test('a deployment mid-run and once it has finished', async ({ page }) => {
      await page.goto('/')
      await send(page, 'Deploy v1.5.0-rc.1 to staging.')
      await page.getByTestId('approval-card').getByTestId('approval-approve').click()

      const card = page.getByTestId('deployment-progress')
      await expect(card).toHaveAttribute('data-status', 'running')
      await expectNoViolations(page)

      await expect(card).toHaveAttribute('data-status', 'succeeded', { timeout: 30_000 })
      await expectNoViolations(page)
    })
  })
}
