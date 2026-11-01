/**
 * The one workspace Durable Object every client resolves to.
 *
 * Lives here for the same reason `API_ROUTES` does: `apps/api` and
 * `apps/mcp-issues` both call `idFromName` with it, in different Workers, and
 * scenario S-F ("same workspace, two clients") is only true while the two
 * strings agree. Held apart in each package they could drift silently — a
 * divergent name resolves to a *different* object, which seeds itself from
 * `createWorkspaceSeed()` and therefore reads like a perfectly healthy board.
 * Only a write made through one client and missing from the other would show
 * it, and that is the one path with no automated coverage.
 */
export const WORKSPACE_DO_NAME = 'demo'

export const API_ROUTES = {
  chat: '/api/chat',
  workspace: '/api/workspace',
  workspaceReset: '/api/workspace/reset',
  /** `POST /api/workspace/undo` with `{ changeId }` — an approved card's Undo button. */
  workspaceUndo: '/api/workspace/undo',
  /** `POST /api/deployments/:id/cancel` — the progress card's Cancel button. */
  deploymentCancel: '/api/deployments/:id/cancel',
} as const

export type ChatRole = 'user' | 'assistant' | 'system'

export * from './chat-history'
export * from './rate-limit-key'
export * from './workspace/types'
export * from './workspace/fixtures'
export * from './workspace/dates'
export * from './workspace/burndown'
