import { describe, expect, it } from 'vitest'
import { API_ROUTES } from '../src/index'

describe('API_ROUTES', () => {
  it('exposes the chat endpoint path', () => {
    expect(API_ROUTES.chat).toBe('/api/chat')
  })

  it('exposes the workspace endpoint path', () => {
    expect(API_ROUTES.workspace).toBe('/api/workspace')
  })
})
