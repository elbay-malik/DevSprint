<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { MAX_USER_MESSAGE_CHARS } from '@devsprint/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDevSprintChat } from '../composables/useDevSprintChat'
import { pendingApprovalCount } from '../lib/approvals'
import { chatErrorDescription } from '../lib/error-copy'
import { promptHistory, stepHistory, type HistoryStep } from '../lib/prompt-history'

const chat = useDevSprintChat()
const text = ref('')
const streaming = computed(() => chat.status === 'submitted' || chat.status === 'streaming')

/**
 * The SDK answers approvals against the LAST message only, and it leaves the
 * chat status on 'ready' while it waits for a human. Sending anything now would
 * push the assistant turn out of last place and silently orphan every open card,
 * so Send stays blocked until the decisions are in. Typing is not: the next
 * instruction can be drafted meanwhile, and it is still there once the cards
 * are answered and their turn has run.
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

/** Up and Down walk the prompts sent this session, like a shell's history. */
const history = computed(() => promptHistory(chat.messages))
let recalled: number | undefined

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  // Mid-composition, or a modified arrow (select, jump to start), is not a recall.
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  // Read-only while a turn runs.
  if (streaming.value) return
  const current: HistoryStep = { index: recalled, text: text.value }
  const step = stepHistory(history.value, current, event.key === 'ArrowUp' ? 'older' : 'newer')
  if (step === undefined) return
  event.preventDefault()
  recalled = step.index
  text.value = step.text
  const input = event.target as HTMLInputElement
  void nextTick(() => input.setSelectionRange(step.text.length, step.text.length))
}

watch(
  () => chat.error,
  (error) => {
    if (error) {
      toast.error("The copilot couldn't reply", {
        description: chatErrorDescription(error),
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
  recalled = undefined
}
</script>

<template>
  <form class="flex flex-col gap-1.5 p-4 lg:px-6" @submit.prevent="onSubmit">
    <div class="flex items-center gap-2">
      <!--
        Read-only, not disabled, while a turn runs: a disabled field drops the
        focus it holds to <body>, and the screen reader's place with it.
        aria-disabled says it is unavailable; onSubmit guards it. While approvals
        are open it stays editable, so the next message can be drafted, and only
        sending waits.
      -->
      <Input
        v-model="text"
        data-testid="chat-input"
        data-chat-composer
        aria-label="Message the copilot"
        :placeholder="awaitingApproval ? lockedPlaceholder : 'Ask the copilot…'"
        :aria-describedby="awaitingApproval ? 'composer-locked-hint' : undefined"
        :readonly="streaming"
        :aria-disabled="streaming ? 'true' : undefined"
        class="aria-disabled:cursor-not-allowed"
        autocomplete="off"
        :maxlength="MAX_USER_MESSAGE_CHARS"
        @keydown="onKeydown"
      />
      <!-- Names what it stops: during a deploy the card's own Cancel sits above,
           and this ends only the reply, not the deployment. -->
      <Button
        v-if="streaming"
        type="button"
        variant="outline"
        data-testid="chat-stop"
        aria-label="Stop reply"
        @click="chat.stop()"
      >
        Stop reply
      </Button>
      <Button v-else type="submit" data-testid="chat-send" :disabled="busy || !text.trim()">
        Send
      </Button>
    </div>
    <!-- The placeholder says why Send waits until a draft hides it; then this
         line says it instead. Screen readers always have it, as the field's
         description. -->
    <p
      v-if="awaitingApproval"
      id="composer-locked-hint"
      data-testid="composer-locked-hint"
      :class="text.trim() ? 'text-muted-foreground text-xs text-pretty' : 'sr-only'"
    >
      {{ lockedHint }}
    </p>
  </form>
</template>
