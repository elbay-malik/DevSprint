<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import { pendingApprovalCount } from '../lib/approvals'

const chat = useDevSprintChat()
const text = ref('')
const streaming = computed(() => chat.status === 'submitted' || chat.status === 'streaming')

/**
 * The SDK answers approvals against the LAST message only, and it leaves the
 * chat status on 'ready' while it waits for a human. Sending anything now would
 * push the assistant turn out of last place and silently orphan every open card,
 * so the composer stays locked until the decisions are in.
 */
const pendingApprovals = computed(() => pendingApprovalCount(chat.messages.at(-1)?.parts))
const awaitingApproval = computed(() => pendingApprovals.value > 0)

/**
 * Why the composer is locked. The placeholder is the short form, sized to fit
 * the field at 390px; the hint it is described by says it in full.
 */
const lockedPlaceholder = computed(() =>
  pendingApprovals.value > 1
    ? `Decide on the ${pendingApprovals.value} changes above`
    : 'Decide on the change above',
)
const lockedHint = computed(() =>
  pendingApprovals.value > 1
    ? `Approve or deny the ${pendingApprovals.value} changes above to continue.`
    : 'Approve or deny the change above to continue.',
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
    <!--
      Read-only, not disabled, while a turn runs or approvals are open: a
      disabled field drops the focus it holds to <body>, and the screen reader's
      place with it. aria-disabled says it is unavailable; onSubmit guards it.
    -->
    <Input
      v-model="text"
      data-testid="chat-input"
      data-chat-composer
      aria-label="Message the copilot"
      :placeholder="awaitingApproval ? lockedPlaceholder : 'Ask the copilot…'"
      :aria-describedby="awaitingApproval ? 'composer-locked-hint' : undefined"
      :readonly="busy"
      :aria-disabled="busy ? 'true' : undefined"
      class="aria-disabled:cursor-not-allowed"
      autocomplete="off"
    />
    <p v-if="awaitingApproval" id="composer-locked-hint" class="sr-only">{{ lockedHint }}</p>
    <Button v-if="streaming" type="button" variant="outline" @click="chat.stop()">Stop</Button>
    <Button v-else type="submit" :disabled="busy || !text.trim()">Send</Button>
  </form>
</template>
