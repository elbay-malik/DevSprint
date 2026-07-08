<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDevSprintChat } from '../composables/useDevSprintChat'

const chat = useDevSprintChat()
const text = ref('')
const busy = computed(() => chat.status === 'submitted' || chat.status === 'streaming')

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
      placeholder="Ask the copilot…"
      :disabled="busy"
      autocomplete="off"
    />
    <Button v-if="busy" type="button" variant="outline" @click="chat.stop()">Stop</Button>
    <Button v-else type="submit" :disabled="!text.trim()">Send</Button>
  </form>
</template>
