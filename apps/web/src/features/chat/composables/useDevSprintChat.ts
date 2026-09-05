import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { CHAT_ENDPOINT } from '@/lib/api'
import type { DevSprintUIMessage } from '../types'

export type { DevSprintUIMessage } from '../types'

let chat: Chat<DevSprintUIMessage> | undefined

/** Module-level singleton so every component shares one conversation. */
export function useDevSprintChat(): Chat<DevSprintUIMessage> {
  chat ??= new Chat<DevSprintUIMessage>({
    transport: new DefaultChatTransport({ api: CHAT_ENDPOINT }),
  })
  return chat
}
