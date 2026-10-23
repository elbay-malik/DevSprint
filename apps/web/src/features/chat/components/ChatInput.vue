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
const pendingApprovals = computed(
  () =>
    (chat.messages.at(-1)?.parts ?? []).filter(
      (part) => 'state' in part && part.state === 'approval-requested',
    ).length,
)
const awaitingApproval = computed(() => pendingApprovals.value > 0)

/** Why the composer is locked, named in the field and announced with it. */
const lockedHint = computed(() =>
  pendingApprovals.value > 1
    ? `Approve or deny the ${pendingApprovals.value} changes above to continue…`
    : 'Approve or deny the change above to continue…',
)
const busy = computed(() => streaming.value || awaitingApproval.value)

watch(
  () => chat.error,
  (error) => {
    if (error) {
      toast.error("The copilot couldn't reply", {
        description: error.message || 'Check your connection, then send your message again.',
      })
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
      aria-label="Message the copilot"
      :placeholder="awaitingApproval ? lockedHint : 'Ask the copilot…'"
      :aria-describedby="awaitingApproval ? 'composer-locked-hint' : undefined"
      class="disabled:opacity-100 disabled:placeholder:text-muted-foreground"
      :disabled="busy"
      autocomplete="off"
    />
    <p v-if="awaitingApproval" id="composer-locked-hint" class="sr-only">{{ lockedHint }}</p>
    <Button v-if="streaming" type="button" variant="outline" @click="chat.stop()">Stop</Button>
    <Button v-else type="submit" :disabled="!text.trim()">Send</Button>
  </form>
</template>
