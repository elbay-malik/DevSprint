# @devsprint/mcp-issues

The public issues MCP server. An external host — Claude Desktop, Cursor — adds this as a remote
Streamable HTTP server and gets the four issue tools; the same workspace is what the DevSprint SPA
shows, so a write made in the host appears on the board (scenario S-F).

## Endpoints

| Route     | Method | Purpose                           |
| --------- | ------ | --------------------------------- |
| `/health` | GET    | Liveness probe — `{ "ok": true }` |
| `/mcp`    | POST   | Streamable HTTP MCP endpoint      |

## Tools

`list_issues`, `search_issues`, `create_issue`, `update_issue_status` — the four the tool inventory
assigns to the issues server. Descriptions and input schemas come from `@devsprint/shared/tools`,
the same objects the in-app agent uses, so the two clients cannot drift apart.

Two of those are writes, and they carry no approval flag here. Over MCP the host runs its own
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

## Not deployed yet

Scenario S-F's first precondition is a deployed server with a published URL, so the scenario is only
fully runnable once Phase 14 does the deploy. Everything below that line is verified locally: the
handshake, `tools/list`, and a `create_issue` whose result shows up in the api Worker's board.
