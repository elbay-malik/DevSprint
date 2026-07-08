export const API_ROUTES = {
  chat: '/api/chat',
} as const

export type ChatRole = 'user' | 'assistant' | 'system'

export * from './workspace/types'
export * from './workspace/fixtures'
