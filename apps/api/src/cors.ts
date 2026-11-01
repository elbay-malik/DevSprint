/**
 * Which browser origins may call the api, from `CORS_ORIGIN`.
 *
 * A comma-separated list, because production has more than one: the SPA itself
 * and its PR previews, which Cloudflare serves at
 * `<alias>-devsprint-web.<subdomain>.workers.dev` (ADR-0019). An entry may hold
 * one `*`, and it matches a run of letters, digits and hyphens only — never a
 * dot — so `https://pr-*-devsprint-web.example.workers.dev` admits every PR
 * alias but not `https://evil.com/-devsprint-web.example.workers.dev`, a
 * host that merely ends with the same suffix, or the hash-named URL Cloudflare
 * gives every uploaded version.
 *
 * This decides which pages a browser lets read the responses, and which pages
 * may POST at all (the refusal in index.ts). Neither is access control: the
 * board is public by design (ADR-0014), and only a browser can't lie about its
 * origin. A client that isn't one sends what it likes.
 */
export function corsOriginMatcher(config: string): (origin: string) => string | null {
  const patterns = config
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [head = '', ...rest] = entry.split('*')
      if (rest.length > 1) throw new Error(`CORS_ORIGIN entry has more than one '*': ${entry}`)
      return rest.length === 0
        ? new RegExp(`^${escape(head)}$`)
        : new RegExp(`^${escape(head)}[a-z0-9-]+${escape(rest[0] ?? '')}$`)
    })

  return (origin) => (patterns.some((pattern) => pattern.test(origin)) ? origin : null)
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}
