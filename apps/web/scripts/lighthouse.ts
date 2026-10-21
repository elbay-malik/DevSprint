/**
 * The Phase 12 gate, made repeatable: every Lighthouse category ≥ 90, on the
 * mobile and desktop presets, as the median of three runs.
 *
 * It audits whatever is already serving the URL, because a meaningful score
 * needs the production build *and* the api — without the Worker the board fetch
 * fails, the console logs it, and Best Practices drops for a reason that is not
 * the SPA's. The api only allows its configured CORS origin, so serve the build
 * on that port:
 *
 *   pnpm --filter @devsprint/api exec wrangler dev --var MODEL_PROVIDER:mock
 *   pnpm --filter @devsprint/web build && pnpm --filter @devsprint/web preview --port 5173
 *   pnpm --filter @devsprint/web lighthouse
 *
 * Not a CI step: shared runners swing the simulated-throttling performance
 * score by several points between identical runs, so a hard 90 there would fail
 * on noise, and a gate that fails on noise gets ignored. The deterministic half
 * of accessibility is gated in CI by e2e/a11y.spec.ts instead, across far more
 * states than the empty first paint Lighthouse sees.
 */
import { spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const URL = process.argv[2] ?? 'http://localhost:5173'
const RUNS = 3
const THRESHOLD = 90
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const

type Report = { categories: Record<string, { score: number | null }> }

function audit(preset: 'mobile' | 'desktop', attempt = 1): Report {
  const args = [
    URL,
    '--output=json',
    '--output-path=stdout',
    '--quiet',
    '--chrome-flags=--headless=new',
    ...(preset === 'desktop' ? ['--preset=desktop'] : []),
  ]
  // Playwright's own Chromium, so this needs no system Chrome.
  const result = spawnSync('lighthouse', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CHROME_PATH: chromium.executablePath() },
  })
  // NO_FCP means headless Chrome never painted, so nothing was measured — seen
  // intermittently on a healthy page. Retried once; a low score never is.
  if (result.status !== 0 && result.stderr.includes('NO_FCP') && attempt === 1) {
    return audit(preset, attempt + 1)
  }
  if (result.status !== 0) throw new Error(`lighthouse exited ${result.status}: ${result.stderr}`)
  return JSON.parse(result.stdout) as Report
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

let failed = false
for (const preset of ['mobile', 'desktop'] as const) {
  const reports = Array.from({ length: RUNS }, () => audit(preset))
  const line = CATEGORIES.map((category) => {
    const scores = reports.map((report) =>
      Math.round((report.categories[category]?.score ?? 0) * 100),
    )
    const score = median(scores)
    if (score < THRESHOLD) failed = true
    return `${category} ${score}${score < THRESHOLD ? ' ✗' : ''} [${scores.join(' ')}]`
  })
  console.log(`${preset.padEnd(7)}  ${line.join('  ')}`)
}

if (failed) {
  console.error(`\nA median fell below ${THRESHOLD}.`)
  process.exit(1)
}
