import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import { trimChatHistory } from '@devsprint/shared'
import { CHAT_ENDPOINT } from '@/lib/api'
import type { DevSprintUIMessage } from '../types'

export type { DevSprintUIMessage } from '../types'

let chat: Chat<DevSprintUIMessage> | undefined

/** Module-level singleton so every component shares one conversation. */
export function useDevSprintChat(): Chat<DevSprintUIMessage> {
  chat ??= new Chat<DevSprintUIMessage>({
    transport: new DefaultChatTransport({
      api: CHAT_ENDPOINT,
      // The transcript on screen keeps growing, so what goes over the wire has to
      // stop, or a long session would hit the server's body limit on every turn.
      // The same range the server keeps, so nothing the model would read is lost.
      prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => ({
        body: { ...body, id, messages: trimChatHistory(messages), trigger, messageId },
      }),
    }),
    // Approvals pause the turn server-side; resending once every card in the
    // step has been answered is what resumes it. This can only be set at
    // construction, so it lives here rather than at a call site.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })
  return chat
}
