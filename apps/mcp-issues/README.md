# @devsprint/mcp-issues

The public issues MCP server. An external host — Claude Desktop, Cursor — adds this as a remote
Streamable HTTP server and gets the five issue tools; the same workspace is what the DevSprint SPA
shows, so a write made in the host appears on the board (scenario S-F).

## Endpoints

| Route     | Method | Purpose                           |
| --------- | ------ | --------------------------------- |
| `/health` | GET    | Liveness probe — `{ "ok": true }` |
| `/mcp`    | POST   | Streamable HTTP MCP endpoint      |

## Tools

`list_issues`, `search_issues`, `create_issue`, `update_issue_status`, `assign_issue` — the five
the tool inventory assigns to the issues server. Descriptions and input schemas come from `@devsprint/shared/tools`,
the same objects the in-app agent uses, so the two clients cannot drift apart.

Three of those are writes, and they carry no approval flag here. Over MCP the host runs its own
tool-permission prompt, which replaces our ApprovalCard
([tool-inventory.md](../../docs/tool-inventory.md) §3.6). What does not change is validation: every
call is checked against the schema before it reaches the workspace, whatever the host allowed.

Domain failures come back as the shared `{ ok, error }` envelope rather than protocol errors, so a
host can read `ISSUE_NOT_FOUND` and recover instead of seeing the call blow up.

## State

This server owns none. It reaches the workspace Durable Object defined in `apps/api` through a
cross-script binding ([ADR-0011](../../docs/adr/0011-workspace-state-in-a-durable-object.md)), which
is what makes "same workspace, two clients" true rather than aspirational.

The server itself is deliberately stateless — a fresh MCP server and transport per request, no
session id generator — following Cloudflare's current guidance for remote MCP servers. The only
Durable Object involved is the workspace.

## Local dev

```sh
pnpm --filter @devsprint/api dev          # must be running: it defines the Durable Object
pnpm --filter @devsprint/mcp-issues dev   # wrangler dev on http://localhost:8788
```

Order matters. The binding resolves only while `devsprint-api` is running, and when it does not,
wrangler falls back to a _separate_ object rather than failing — the calls succeed and return
plausible data that simply is not the shared board. Check for `[connected]` next to
`env.WORKSPACE` in the startup output before trusting a local S-F run.

Drive it by hand with any MCP client, or over curl:

```sh
curl -s -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  http://localhost:8788/mcp
```

## Deployed

The public endpoint is `https://devsprint-mcp-issues.eleo-666.workers.dev/mcp` (Streamable HTTP,
stateless). Add it to any MCP host as a remote server. This is scenario S-F's first precondition.
It deploys with the rest of the topology (`pnpm deploy:all`, see `apps/api/README.md`). The
deploy's smoke checks confirm it lists exactly the five issue tools and reads the same board as
the api. It has no preview URLs, because a preview would write to the production board. The public `/mcp`
endpoint allows 30 requests a minute per client IP. Past that it answers HTTP 429 with a JSON-RPC
error. The in-app agent uses the `Internal` entrypoint and is not counted (ADR-0020).
