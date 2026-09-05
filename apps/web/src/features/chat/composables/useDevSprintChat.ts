import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import { CHAT_ENDPOINT } from '@/lib/api'
import type { DevSprintUIMessage } from '../types'

export type { DevSprintUIMessage } from '../types'

let chat: Chat<DevSprintUIMessage> | undefined

/** Module-level singleton so every component shares one conversation. */
export function useDevSprintChat(): Chat<DevSprintUIMessage> {
  chat ??= new Chat<DevSprintUIMessage>({
    transport: new DefaultChatTransport({ api: CHAT_ENDPOINT }),
    // Approvals pause the turn server-side; resending once every card in the
    // step has been answered is what resumes it. This can only be set at
    // construction, so it lives here rather than at a call site.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })
  return chat
}
