import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { corsOriginMatcher } from './cors'

/** `CORS_ORIGIN` as apps/api/wrangler.jsonc deploys it, so these test the real list. */
function deployedOrigins(): string {
  const path = new URL('../wrangler.jsonc', import.meta.url).pathname
  const { config } = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8')) as {
    config: { vars: { CORS_ORIGIN: string } }
  }
  return config.vars.CORS_ORIGIN
}

const PRODUCTION =
  'https://devsprint-web.eleo-666.workers.dev, https://pr-*-devsprint-web.eleo-666.workers.dev'

describe('corsOriginMatcher', () => {
  it('allows the SPA and nothing else when given one origin', () => {
    const allow = corsOriginMatcher('http://localhost:5173')
    expect(allow('http://localhost:5173')).toBe('http://localhost:5173')
    expect(allow('http://localhost:5174')).toBeNull()
    expect(allow('https://localhost:5173')).toBeNull()
  })

  it('allows the production SPA and its PR preview aliases', () => {
    const allow = corsOriginMatcher(PRODUCTION)
    expect(allow('https://devsprint-web.eleo-666.workers.dev')).not.toBeNull()
    expect(allow('https://pr-14-devsprint-web.eleo-666.workers.dev')).not.toBeNull()
  })

  it('refuses the hash-named URLs of uploaded versions, which nobody reviewed', () => {
    const allow = corsOriginMatcher(deployedOrigins())
    expect(allow('https://devsprint-web.eleo-666.workers.dev')).not.toBeNull()
    expect(allow('https://pr-14-devsprint-web.eleo-666.workers.dev')).not.toBeNull()
    expect(allow('https://3f9a1b2c-devsprint-web.eleo-666.workers.dev')).toBeNull()
  })

  it('never lets the wildcard span a dot, a path or a different host', () => {
    const allow = corsOriginMatcher(PRODUCTION)
    for (const origin of [
      'https://evil.com.-devsprint-web.eleo-666.workers.dev',
      'https://a.b-devsprint-web.eleo-666.workers.dev',
      'https://pr-14-devsprint-web.eleo-666.workers.dev.evil.com',
      'https://-devsprint-web.eleo-666.workers.dev',
      'http://pr-14-devsprint-web.eleo-666.workers.dev',
      'https://pr-14-devsprint-api.eleo-666.workers.dev',
    ]) {
      expect(allow(origin), origin).toBeNull()
    }
  })

  it('treats the dots in an entry literally', () => {
    const allow = corsOriginMatcher('https://devsprint-web.eleo-666.workers.dev')
    expect(allow('https://devsprint-webXeleo-666.workers.dev')).toBeNull()
  })

  it('refuses an entry it cannot read unambiguously', () => {
    expect(() => corsOriginMatcher('https://*-*.workers.dev')).toThrow(/more than one/)
  })
})
