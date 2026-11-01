import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { allowingLocalApi } from './servers'
import { resetBoard, send } from './support'

/**
 * The production build under the headers the Worker really serves, because
 * everything else in this suite runs on Vite dev, which never applies
 * public/_headers (ADR-0025). It covers what the policy could break and no other
 * test would notice: vue-sonner's and reka-ui's inline styles, the inline theme
 * script, and every state that adds markup of its own.
 *
 * The preview's only change to the policy is its `connect-src`, which also
 * allows the local api (e2e/servers.ts). Rewriting the header here with
 * `page.route` won't do: Chromium treats a document Playwright fulfils as
 * outside the loopback address space, and then refuses its calls to the api.
 */
const PREVIEW = 'http://localhost:4173'

const POLICY = /^\s*Content-Security-Policy: (.+)$/m.exec(
  readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'),
)?.[1]

test.use({ baseURL: PREVIEW, colorScheme: 'dark' })

/** What the browser refused, as it reports it to the console. */
function collectViolations(page: Page): string[] {
  const violations: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text())
  })
  return violations
}

test.beforeEach(async ({ request }) => {
  await resetBoard(request)
})

test.describe('the headers the Worker serves', () => {
  for (const path of ['/', '/no/such/route', '/robots.txt']) {
    test(`are the ones in public/_headers on ${path}`, async ({ request }) => {
      const res = await request.get(`${PREVIEW}${path}`)
      expect(POLICY).toBeTruthy()
      expect(res.headers()['content-security-policy']).toBe(allowingLocalApi(POLICY ?? ''))
      expect(res.headers()['x-content-type-options']).toBe('nosniff')
      expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
      expect(res.headers()['permissions-policy']).toContain('camera=()')
    })
  }

  test('refuse a connection the policy does not name', async ({ page }) => {
    // Refused before it reaches the network. This also proves that
    // `collectViolations` sees a real refusal, which is all that keeps the tests
    // below from passing on nothing.
    const violations = collectViolations(page)
    await page.goto('/')
    await page.evaluate(() => fetch('https://example.invalid/').catch(() => undefined))
    await expect.poll(() => violations.join('\n')).toContain('connect-src')
  })
})

test.describe('the app under its policy', () => {
  let violations: string[]

  test.beforeEach(({ page }) => {
    violations = collectViolations(page)
  })

  test.afterEach(() => {
    expect(violations).toEqual([])
  })

  test('the inline theme script runs, before any bundle could', async ({ page }) => {
    // lib/theme.ts also sets the class once the bundle loads, so with the
    // bundles blocked the only thing left that can is the hashed inline script.
    await page.route('**/assets/*.js', (route) => route.abort())
    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
      'content',
      '#0a0a0a',
    )
  })

  test('the empty shell, with reka-ui’s scroll area', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('workspace-source')).toHaveText(/live/i)
    await expect(page.locator('[data-slot="scroll-area-viewport"]').first()).toBeAttached()
  })

  test('a burndown chart and an issue table', async ({ page }) => {
    await page.goto('/')
    await send(page, 'Is Sprint 12 on track? Show me the burndown and the blocked issues.')
    await expect(page.getByTestId('burndown-chart')).toBeVisible()
    await expect(page.getByTestId('issue-table')).toBeVisible()
  })

  test('pending approvals, then a recorded outcome', async ({ page }) => {
    await page.goto('/')
    await send(page, 'Mark DS-7 as done.')
    const card = page.getByTestId('approval-card')
    await card.getByTestId('approval-approve').click()
    await expect(card.getByTestId('approval-undo')).toBeVisible()
  })

  test('a deployment from start to finish', async ({ page }) => {
    await page.goto('/')
    await send(page, 'Deploy v1.5.0-rc.1 to staging.')
    await page.getByTestId('approval-card').getByTestId('approval-approve').click()
    const card = page.getByTestId('deployment-progress')
    await expect(card).toHaveAttribute('data-status', 'running')
    await expect(card).toHaveAttribute('data-status', 'succeeded', { timeout: 30_000 })
  })

  test('an error toast from vue-sonner', async ({ page }) => {
    await page.route('**/api/chat', (route) => route.abort())
    await page.goto('/')
    await send(page, 'Mark DS-7 as done.')
    await expect(page.locator('[data-sonner-toast]')).toContainText("The copilot couldn't reply")
  })
})
