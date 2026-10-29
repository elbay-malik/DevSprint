/**
 * The three servers the browser suite needs, in start order. Shared by
 * playwright.config.ts and scripts/ci-local.ts so the two cannot disagree on
 * how the stack is started.
 *
 * The api goes first because it defines the workspace Durable Object that
 * mcp-issues binds to (apps/mcp-issues/README.md).
 *
 * The Workers' readiness URLs use 127.0.0.1 rather than localhost: wrangler
 * binds both loopback addresses explicitly, so this always reaches it, whereas
 * `localhost` can resolve to an IPv6 wildcard some unrelated process holds on
 * the same port.
 */
export interface E2EServer {
  name: string
  command: string
  url: string
}

export const E2E_SERVERS: E2EServer[] = [
  {
    name: 'api',
    // `--var MODEL_PROVIDER:mock` pins the scripted model regardless of any
    // local apps/api/.dev.vars, so e2e stays deterministic, offline and free.
    // A reused local server is checked for this too (e2e/support.ts).
    command:
      'pnpm --filter @devsprint/api exec wrangler dev --var MODEL_PROVIDER:mock --var RESET_COOLDOWN_SECONDS:0 --var CORS_ORIGIN:http://localhost:5173',
    url: 'http://127.0.0.1:8787/api/health',
  },
  {
    // The agent sources its issue tools from here, so the browser tests
    // exercise the MCP path rather than the local fallback.
    name: 'mcp-issues',
    command: 'pnpm --filter @devsprint/mcp-issues exec wrangler dev',
    url: 'http://127.0.0.1:8788/health',
  },
  {
    name: 'web',
    command: 'pnpm --filter @devsprint/web dev',
    url: 'http://localhost:5173',
  },
]
