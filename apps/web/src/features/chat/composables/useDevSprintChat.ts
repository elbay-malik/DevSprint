import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { CHAT_ENDPOINT } from '@/lib/api'

let chat: Chat<UIMessage> | undefined

/** Module-level singleton so every component shares one conversation. */
export function useDevSprintChat(): Chat<UIMessage> {
  chat ??= new Chat<UIMessage>({
    transport: new DefaultChatTransport({ api: CHAT_ENDPOINT }),
  })
  return chat
}
