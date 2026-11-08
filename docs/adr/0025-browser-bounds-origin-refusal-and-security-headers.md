# ADR-0025: Browser bounds: refuse other origins' writes and send security headers

- Status: Accepted
- Date: 2026-11-01
- Deciders: repo owner (solo project)

## Context and Problem Statement

The security audit of 2026-10-26 (kept out of the repo, as in ADR-0024) found that the demo told
browsers almost nothing. No response carried a CSP, `nosniff` or a referrer policy, and any site
could frame the SPA. CORS was the api's only cross-origin handling, and CORS never refuses a
request: a hostile page could send a simple POST and only lose the right to read the answer. So
that page got chat turns from its visitors' IP addresses, which also spend the day's token budget,
and one board reset per cooldown. `CORS_ORIGIN` also trusted any `*-devsprint-web` host, which
includes the hash-named URL Cloudflare gives every uploaded version.

The board has to stay public (ADR-0014), so this can't turn into authentication. curl, the smoke
script and an MCP host have to keep working. The question is what a browser should be told to
refuse, and how to test that, given that the e2e suite runs on Vite dev, which never applies
`public/_headers`.

## Decision

We will refuse a POST whose `Origin` is not an allowed one, and we will send security headers from
both Workers a browser talks to.

**Origins (`apps/api/src/index.ts`, `apps/api/wrangler.jsonc`):**

- A POST under `/api/` with an `Origin` that `CORS_ORIGIN` does not list gets a 403 with
  `FORBIDDEN_ORIGIN`, ahead of every limiter and body read. `Origin: null` matches nothing, so a
  sandboxed frame is refused too.
- A request with no `Origin` passes. Browsers always send it on a cross-origin POST, so only
  non-browser clients leave it out, and those could send any value anyway.
- `CORS_ORIGIN` lists the SPA and `https://pr-*-devsprint-web...`, which still fits ADR-0019's "the
  SPA plus its preview aliases".

**The SPA (`apps/web/public/_headers`):** one rule on `/*`, which covers the SPA fallback too.

- `script-src 'self'` plus the sha256 of the one inline script, the theme script in `index.html`.
  It stays inline and hashed. A file would add a render-blocking request to the first paint that
  the Lighthouse gate measures (ADR-0017).
- `style-src 'self' 'unsafe-inline'`. It can't be tightened today: without it the browser refuses
  the `<style>` that reka-ui's scroll area injects, which `csp.spec.ts` showed by removing it.
- `connect-src 'self'` plus the production api. PR previews call the same api (ADR-0019), and
  `'self'` follows the alias.
- `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'` and `form-action 'none'`. The one
  `<form>` in the app submits through `@submit.prevent`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a
  `Permissions-Policy` that turns off the camera, microphone and geolocation.

**The api (`apps/api/src/index.ts`):** Hono's `secureHeaders()` with its defaults, on every route and
outside CORS, so a refusal or a 404 has them too. No CSP, because it serves no documents.

**The tests:**

- `apps/web/src/lib/csp-headers.test.ts` hashes the inline scripts in `index.html` and compares them
  with `_headers`. It runs in `pnpm test`, so a changed script or a Prettier rewrite fails at once.
- `apps/web/e2e/csp.spec.ts` drives the production build on `wrangler dev`, which applies
  `_headers` as the deployed Worker does, through the states that add markup: the shell, a chart, an
  approval, a deployment and a vue-sonner toast. Any CSP message on the console fails it. The
  preview's only change to the policy is adding the local api to `connect-src`.
- `scripts/smoke.ts` checks the deployed CSP on `/` and on an SPA route, that its `connect-src`
  names the api the bundle calls, the api's `nosniff`, and both origin refusals.

## Consequences

- Positive: another site can no longer use a visitor's browser to run chat turns or reset the
  board, and it can't frame the demo.
- Positive: injected markup has much less to work with, should anything ever slip past the rule
  that all text goes through Vue interpolation.
- Positive: the browser suite now runs the production bundle as well as Vite dev.
- Negative: editing the inline theme script means updating its hash in `_headers`. The test says so.
- Negative: the api origin is written in `_headers` as well as `.env.production`, and only the smoke
  check after a deploy compares them.
- Negative: a dev SPA on a fallback port such as 5174 gets a 403 until `CORS_ORIGIN` names it.
- Negative: this is not access control. curl needs no browser, so the per-IP limits and the cooldown
  (ADR-0024) stay what protects the board from a script.
- Negative: `Cross-Origin-Resource-Policy: same-origin` on the api is proven against CORS-mode
  fetches only in the browser suite, across local ports. A preview can't test a new api header,
  because it calls production, so the first deployed turn is the real check.
- Negative: `apps/mcp-issues` sends none of these. It is a JSON-RPC endpoint with no browser surface,
  so this is a known gap and not an oversight.
- Revisit if Cloudflare Web Analytics is turned on for the web Worker: its injected beacon is neither
  hashed nor in `connect-src`, so the policy would block it.

## Alternatives Considered

- **Requiring `Origin`:** breaks curl, the smoke script and Playwright's `request.post`, and turns a
  public board (ADR-0014) into one with a token anyone can type.
- **Refusing on `Content-Type` instead:** reset has no body, so it has no type to check, and it
  would not say who sent the request. `Origin` is the header a page can't set.
- **A nonce for the inline script:** an assets-only Worker has no per-response step to mint one
  (ADR-0009).
- **Testing the CSP on Vite dev with `page.route` adding the header:** dev is not what ships, and
  Chromium treats a document Playwright fulfils as outside the loopback address space, so its calls
  to the local api are refused.

## References

- The 2026-10-26 security audit, findings SEC-06, SEC-17 and SEC-31 (not committed)
- [ADR-0014](0014-daily-reset-alarm-and-a-persisted-approval-ledger.md): why the board stays public
- [ADR-0019](0019-deploy-topology-and-spa-only-previews.md): the deploy topology and preview aliases
- [ADR-0024](0024-harden-the-shared-board.md): the limits that deal with non-browser clients
- `apps/web/public/_headers`, `apps/web/e2e/csp.spec.ts`, `apps/api/src/cors.ts`

## Status note — 2026-11-08

The SPA now sends `Strict-Transport-Security: max-age=31536000` from `_headers`. The zone redirects
plain http to https ("Always Use HTTPS" is on), so the header only takes effect after a first
secure visit, and from then on the browser makes no plain-http request to this host for a year. It
has no `includeSubDomains`, since nothing is served under this host, and no `preload`, which is hard
to undo. The api already sends the header through Hono's `secureHeaders`.
