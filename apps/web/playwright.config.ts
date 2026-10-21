import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Every spec drives the one shared workspace (ADR-0014) and resets it first,
  // so two files in parallel workers wipe each other's board mid-test — a
  // deployment vanishes under its own progress card. One worker, on purpose.
  workers: 1,
  use: { baseURL: 'http://localhost:5173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Both panes are under test, so both servers run: the SPA hydrates its board
  // from the Worker and the composer streams through it.
  webServer: [
    {
      // The agent sources its issue tools from here, so the browser tests
      // exercise the MCP path rather than the local fallback.
      command: 'pnpm --filter @devsprint/mcp-issues exec wrangler dev',
      url: 'http://localhost:8788/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // `--var MODEL_PROVIDER:mock` pins the scripted model regardless of any
      // local apps/api/.dev.vars, so e2e stays deterministic, offline and free.
      command: 'pnpm --filter @devsprint/api exec wrangler dev --var MODEL_PROVIDER:mock',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
