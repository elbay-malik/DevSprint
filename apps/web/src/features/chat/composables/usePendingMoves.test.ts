import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const chat = reactive({ messages: [] as { id: string; role: string; parts: object[] }[] })

vi.mock('./useDevSprintChat', () => ({ useDevSprintChat: () => chat }))

const { usePendingMoves } = await import('./usePendingMoves')

const statusChange = (issueKey: string, state: string) => ({
  type: 'tool-update_issue_status',
  toolCallId: `call-${issueKey}`,
  state,
  input: { issueKey, status: 'done' },
  approval: { id: `a-${issueKey}` },
})

describe('usePendingMoves', () => {
  it('follows the last message’s open status changes as they are decided', () => {
    const parts = [statusChange('DS-7', 'approval-requested')]
    chat.messages = [
      // An earlier turn's leftovers are never answerable, so they never mark the board.
      { id: 'm0', role: 'assistant', parts: [statusChange('DS-9', 'approval-requested')] },
      { id: 'm1', role: 'assistant', parts },
    ]
    const moves = usePendingMoves()
    expect([...moves.value.keys()]).toEqual(['DS-7'])

    chat.messages[1]!.parts[0] = statusChange('DS-7', 'approval-responded')
    expect(moves.value.size).toBe(0)
  })
})
