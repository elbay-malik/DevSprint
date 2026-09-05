export const API_ROUTES = {
  chat: '/api/chat',
  workspace: '/api/workspace',
} as const

export type ChatRole = 'user' | 'assistant' | 'system'

export * from './workspace/types'
export * from './workspace/fixtures'
