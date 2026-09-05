<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDevSprintChat } from '../composables/useDevSprintChat'

const chat = useDevSprintChat()
const text = ref('')
const streaming = computed(() => chat.status === 'submitted' || chat.status === 'streaming')

/**
 * The SDK answers approvals against the LAST message only, and it leaves the
 * chat status on 'ready' while it waits for a human. Sending anything now would
 * push the assistant turn out of last place and silently orphan every open card,
 * so the composer stays locked until the decisions are in.
 */
const awaitingApproval = computed(() =>
  (chat.messages.at(-1)?.parts ?? []).some(
    (part) => 'state' in part && part.state === 'approval-requested',
  ),
)
const busy = computed(() => streaming.value || awaitingApproval.value)

watch(
  () => chat.error,
  (error) => {
    if (error) {
      toast.error('Chat request failed', { description: error.message })
      chat.clearError()
    }
  },
)

function onSubmit() {
  const value = text.value.trim()
  if (!value || busy.value) return
  void chat.sendMessage({ text: value })
  text.value = ''
}
</script>

<template>
  <form class="flex items-center gap-2 p-4 lg:px-6" @submit.prevent="onSubmit">
    <Input
      v-model="text"
      data-testid="chat-input"
      :placeholder="awaitingApproval ? 'Approve or deny above to continue…' : 'Ask the copilot…'"
      :disabled="busy"
      autocomplete="off"
    />
    <Button v-if="streaming" type="button" variant="outline" @click="chat.stop()">Stop</Button>
    <Button v-else type="submit" :disabled="!text.trim()">Send</Button>
  </form>
</template>
