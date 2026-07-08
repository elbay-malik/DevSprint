# @devsprint/api

Hono-on-Cloudflare-Workers backend. Currently serves `GET /api/health` and a streaming
`POST /api/chat` echo (AI SDK v6 UI message stream); the agent loop arrives in Phase 3+.

## Local dev

```sh
pnpm --filter @devsprint/api dev   # wrangler dev on http://localhost:8787
```

CORS is locked to the origin in the `CORS_ORIGIN` var (`http://localhost:5173` in dev).

After changing `wrangler.jsonc` bindings, regenerate the committed Worker types:

```sh
pnpm --filter @devsprint/api cf-typegen
```

## One-time deploy runbook (not executed yet)

1. `pnpm dlx wrangler login`
2. `pnpm --filter @devsprint/api deploy` — note the printed Worker URL
3. Set `VITE_API_URL` in `apps/web/.env.production` to that URL
4. `pnpm --filter @devsprint/web deploy` — note the printed web URL
5. Update `CORS_ORIGIN` in `apps/api/wrangler.jsonc` (or via a dashboard env override) to the
   web URL and redeploy the api

CI never deploys; `pnpm build` runs `wrangler deploy --dry-run` which needs no Cloudflare auth.
