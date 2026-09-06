export const API_ROUTES = {
  chat: '/api/chat',
  workspace: '/api/workspace',
  workspaceReset: '/api/workspace/reset',
  /** `POST /api/deployments/:id/cancel` — the progress card's Cancel button. */
  deploymentCancel: '/api/deployments/:id/cancel',
} as const

export type ChatRole = 'user' | 'assistant' | 'system'

export * from './workspace/types'
export * from './workspace/fixtures'
