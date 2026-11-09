import { defineConfig, devices } from '@playwright/test'
import { E2E_SERVERS } from './e2e/servers'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Every spec drives the one shared workspace (ADR-0014) and resets it first,
  // so two files in parallel workers wipe each other's board mid-test — a
  // deployment vanishes under its own progress card. One worker, on purpose.
  workers: 1,
  // No retries: the bugs this repo has had only showed under load, and a retry
  // turns exactly that kind of failure into a green run.
  retries: 0,
  // A stray `test.only` would otherwise shrink CI to one test and stay green.
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // The first-visit card would sit over the board in every other spec, so it
    // starts dismissed; e2e/guide.spec.ts clears this to see a first visit.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [{ name: 'guide:devsprint:v1', value: 'dismissed' }],
        },
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Both panes and the production headers are under test, so all four servers
  // run; e2e/servers.ts defines them for this file and scripts/ci-local.ts
  // alike. Playwright starts them in order unless something else already has
  // (E2E_EXTERNAL_SERVERS=1, set by `pnpm ci:local`).
  webServer: process.env.E2E_EXTERNAL_SERVERS
    ? []
    : E2E_SERVERS.map((server) => ({
        command: server.command,
        url: server.url,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      })),
})
