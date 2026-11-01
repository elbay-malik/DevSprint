import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import headers from '../../public/_headers?raw'

/** The directive's sources, read from the `_headers` file a deploy serves. */
function cspSources(directive: string): string[] {
  const csp = /Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? ''
  const entry = csp.split('; ').find((part) => part.startsWith(`${directive} `)) ?? ''
  return entry.split(' ').slice(1)
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

/**
 * The inline theme script runs only if its exact bytes hash to what the policy
 * allows. A stale hash has no loud symptom: `lib/theme.ts` sets the theme after
 * load anyway, so the app just flashes white in dark mode. And `pnpm dev`, which
 * ignores `_headers`, would never show it (ADR-0025).
 */
describe('the CSP in public/_headers', () => {
  it('allows every inline script in index.html, and nothing else inline', async () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    expect(inline.length).toBeGreaterThan(0)

    const hashes = await Promise.all(inline.map(async ([, body]) => sha256(body ?? '')))
    expect(cspSources('script-src').sort()).toEqual(
      ["'self'", ...hashes.map((hash) => `'sha256-${hash}'`)].sort(),
    )
  })

  it('never allows inline script or eval in general', () => {
    expect(cspSources('script-src')).not.toContain("'unsafe-inline'")
    expect(cspSources('script-src')).not.toContain("'unsafe-eval'")
  })

  it('stops the demo being framed', () => {
    expect(cspSources('frame-ancestors')).toEqual(["'none'"])
  })
})
