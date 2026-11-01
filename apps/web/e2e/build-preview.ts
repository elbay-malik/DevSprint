/**
 * Builds the SPA that csp.spec.ts drives: the production bundle and its real
 * headers, pointed at the local stack. It goes to its own folder, so a deploy can
 * never pick up the localhost urls from `dist`.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { allowingLocalApi } from './servers.ts'

const WEB = join(import.meta.dirname, '..')
const OUT = 'dist-e2e'

const build = spawnSync('pnpm', ['exec', 'vite', 'build', '--outDir', OUT, '--emptyOutDir'], {
  cwd: WEB,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_API_URL: 'http://localhost:8787',
    VITE_MCP_URL: 'http://localhost:8788/mcp',
  },
})
if (build.status !== 0) process.exit(build.status ?? 1)

const path = join(WEB, OUT, '_headers')
const headers = readFileSync(path, 'utf8')
const local = allowingLocalApi(headers)
if (local === headers) throw new Error(`${path} has no connect-src to extend`)
writeFileSync(path, local)
