# ADR-0019: Deploy topology, a self-bootstrapping deploy, and SPA-only PR previews

- Status: Accepted
- Date: 2026-10-21
- Deciders: repo owner (solo project)

## Context and Problem Statement

Phase 14's line is "Backend Worker + one Worker per MCP server + Workers Static Assets SPA;
push-to-main deploys; PR previews". The topology already existed as three committed wrangler
configs. Three things stood between it and a live demo.

**The two Workers bind each other.** `devsprint-api` service-binds `devsprint-mcp-issues`, and
`devsprint-mcp-issues` binds the `WorkspaceDO` class that `devsprint-api` defines. So neither can
be deployed first. The committed runbook had someone comment a block out by hand, deploy, restore
it, and deploy again. That is a step people forget, and CI cannot do it at all.

**PR previews meet Durable Objects.** Cloudflare's docs say "Version URLs are not generated for
Workers that implement a Durable Object". The newer Previews feature does support Durable
Objects, but "Service bindings from a Preview call the bound Worker's production deployment". A
preview api would therefore source its issue tools from the production MCP Worker, which writes
to the production board. Durable Object class changes also "must be applied through
`wrangler deploy`", not version uploads.

**The production build had never talked to the api.** `apps/web/.env.production` left
`VITE_API_URL` unset, so a production build called relative `/api` paths. Those reach the
assets-only Worker, which answers with `index.html`, and the board quietly fell back to seed
data. Phase 12's Lighthouse scores (ADR-0017) were measured on such a build.

## Decision

**Three Workers on workers.dev, production config committed:**

- `devsprint-web.eleo-666.workers.dev`
- `devsprint-api.eleo-666.workers.dev`
- `devsprint-mcp-issues.eleo-666.workers.dev/mcp`, the public MCP endpoint for scenario S-F

`wrangler.jsonc` `vars` now hold the deployed values. `CORS_ORIGIN` is the SPA plus its preview
aliases, and `MODEL_PROVIDER` is `mock` until real keys are set, which is a reviewable one-line
change. `pnpm dev` and the e2e suite override those values with `--var` for localhost.

`CORS_ORIGIN` is a comma-separated allowlist. An entry may hold one `*`, which matches letters,
digits and hyphens only, so a wildcard can never span a dot (`src/cors.ts`).

**One deploy script for the first deploy and every one after** (`pnpm deploy:all`,
`scripts/deploy.ts`):

1. Build the SPA first, so a build error stops everything before anything ships.
2. If the MCP Worker does not exist yet, deploy the api from a generated config without the
   service binding. Until the MCP Worker exists, the api serves its local copy of the issue tools,
   and says so in `X-DevSprint-Tools`.
3. Deploy the MCP Worker, then deploy the api again with the binding.
4. Generate `TOOL_APPROVAL_SECRET` once, only when the api lacks it. It is passed through a
   mode-0600 temp file that `--secrets-file` adds to existing secrets, and it is never printed.
5. Deploy the web Worker.
6. Run smoke checks (`scripts/smoke.ts`). Each check names the misconfiguration it catches:
   - the bundle carrying the api URL
   - CORS admitting the SPA and a preview alias, and refusing a stranger
   - the turn served by the intended model, with its tools over the service binding
   - MCP listing exactly four tools
   - MCP and the api reading the same board

   On the first deploy alone, the script also writes through MCP, reads the write back through the
   api, and resets the board. Two untouched boards are identical, so only a write can tell one
   shared object from two fresh ones, and nobody is using the board yet at that point.

**CI deploys on push to `main`, once `checks` and `e2e` pass.** It runs the same script with a
scoped API token. The workflow's run-cancelling concurrency now applies to PRs only, so a quick
second push can no longer kill a deploy halfway between the api and the MCP Worker.

**PR previews are the SPA's alone.** The `preview` job uploads a version of the web Worker with
`--preview-alias pr-<n>` and links `pr-<n>-devsprint-web.<subdomain>` on the PR, running against
the production api.

- This adds no exposure: the production board is already publicly writable by design (ADR-0014).
- The api and MCP Workers set `preview_urls: false`, because a preview of either would act on the
  production board under a URL that suggests isolation.
- Api changes are exercised end to end by CI's e2e stack.

## Consequences

- Positive: the first deploy ran as one command (2026-10-21). All smoke checks passed, including
  the shared-board proof and the rate-limit binding on the Free plan.
- Positive: measured live, Lighthouse scores 100 in all four categories on mobile and desktop,
  median of three runs. That is the honest number ADR-0017's local preview could not give.
- Positive: a fork's PR gets no preview, because it gets no secrets. That is the correct failure,
  not a broken job.
- Negative: a PR that changes the api has no live preview of that change.
- Negative: the smoke checks' read-only board comparison cannot detect two separate Durable Objects
  on later deploys. Only the first deploy's write can, and in production the `script_name` binding
  leaves no dev-registry fallback to drift into.
- Neutral: Lighthouse 13.5 never painted under Playwright 1.61's Chromium (Chrome 149) against the
  live site. Playwright moved to 1.64.0 (Chromium 1248). That was also the source of Phase 12's
  "intermittent" `NO_FCP`.

## Alternatives Considered

- **Serve the SPA and api from one origin** (the web Worker proxies `/api/*` over a service
  binding). This would remove CORS entirely, but it changes ADR-0009's assets-only Worker, and a
  preview's service binding would still call production. The allowlist is smaller.
- **Per-PR api previews with their own Durable Object** (Previews provisions one). The production
  MCP Worker would sit behind the preview's service binding, so a preview would write to the live
  board under a URL that suggests isolation.
- **Wrangler environments for production values**. Bindings and vars are not inherited between
  environments, so all three configs would be duplicated to change two strings.
- **Keep the hand-edited runbook**: rejected, because CI cannot follow it and people forget it.

## References

- [ADR-0009](0009-workers-static-assets-over-pages.md): the assets-only SPA Worker
- [ADR-0014](0014-daily-reset-alarm-and-a-persisted-approval-ledger.md): one shared, public board
- [ADR-0017](0017-accessibility-gated-across-states-not-by-lighthouse.md): corrected by the live
  measurement above
- Cloudflare docs: Version URLs (limitations), Previews, Deployment management (Durable Object
  migrations)

## Status note — 2026-10-22

Corrections and one caveat:

- **CI has not deployed yet.** "CI deploys on push to `main`" is configured
  (`.github/workflows/ci.yml`) but has never run: from 2026-10-22, GitHub Actions refused to start
  any job over an account billing problem. Both deploys so far ran from a laptop with
  `pnpm deploy:all`. The merges after that were gated by `pnpm ci:local`, which runs the workflow's
  own steps. Record the first successful CI deploy here.
- **The model switch really is one line now.** The smoke check reads the expected
  `MODEL_PROVIDER` from `apps/api/wrangler.jsonc`; it used to hard-code `mock`, which would have
  failed the switch.
- **Only e2e overrides `MODEL_PROVIDER` locally.** `pnpm dev` overrides only `CORS_ORIGIN`.
- **The CORS matcher is `apps/api/src/cors.ts`,** and its wildcard matches lowercase letters,
  digits and hyphens. Origins are lowercase.
- **"Chromium 1248" is a Playwright browser revision, not a Chrome version.** Playwright 1.64.0
  ships Chrome 156, against 1.61's Chrome 149.
- **The smoke checks also cover the SPA shell, `robots.txt` and api health.**

## Status note — 2026-10-22 (deploy order)

Every deploy after the first now goes **MCP Worker first, then api**; it used to be api first. A
change that spans both Workers runs half old, half new for a few seconds in either order, because
each calls into the other at runtime. The order decides something else: whether the deploy can be
refused halfway. The MCP Worker binds a Durable Object class that already exists, so the api's state
cannot block it. The api binds an MCP entrypoint that may exist only in the new MCP code, which is
exactly what ADR-0020's `Internal` entrypoint was. That deploy had to be run by hand, in this
order.

The exception is a change that adds a new Durable Object class the MCP Worker binds. Deploy the api
first, by hand. `pnpm deploy:all --plan` prints the order a deploy would take without deploying
anything.

## Status note — 2026-10-22 (live model)

`MODEL_PROVIDER` is now `auto` (ADR-0021). The switch took more than the one line this ADR
promised: both configured models had been retired, so the change also carries new model IDs,
corrected tool descriptions and prompt rules, and evals that work against a live model.

## Status note — 2026-10-25

"Both deploys so far" is out of date. Every deploy so far has run from a laptop with
`pnpm deploy:all`, except the MCP-first `Internal` rollout (ADR-0020), which was run by hand in
that order, as the deploy-order note above says. The 2026-10-25 redeploy of `main` (`97396ca`)
passed every smoke check.
