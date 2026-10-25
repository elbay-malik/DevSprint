import { computed, type ComputedRef } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { pendingStatusMoves } from '../lib/approvals'
import { useDevSprintChat } from './useDevSprintChat'

/**
 * The status changes the chat is waiting on, issue key → requested status, for
 * the board to mark (cause in the chat, effect on the board). Read from the
 * shared conversation rather than handed down through the view, so the board
 * and the transcript cannot disagree about what is pending. The SDK answers
 * approvals against the last message only, so that is the one read. Keys come
 * back as the board spells them, so the board can look its cards up directly.
 */
export function usePendingMoves(): ComputedRef<Map<string, unknown>> {
  const chat = useDevSprintChat()
  const workspace = useWorkspaceStore()
  return computed(() => pendingStatusMoves(chat.messages.at(-1)?.parts, workspace.workspace.issues))
}
