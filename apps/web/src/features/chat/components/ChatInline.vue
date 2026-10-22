<script setup lang="ts">
import type { Inline } from '../lib/chat-text'

/** One run of inline text: plain, bold, italic, code or a line break, all interpolated. */
defineProps<{ parts: Inline[] }>()
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <br v-if="part.kind === 'break'" />
    <strong v-else-if="part.kind === 'strong'" class="font-semibold">{{ part.text }}</strong>
    <em v-else-if="part.kind === 'em'">{{ part.text }}</em>
    <code
      v-else-if="part.kind === 'code'"
      class="bg-background/60 rounded px-1 font-mono text-[0.85em]"
      >{{ part.text }}</code
    >
    <template v-else>{{ part.text }}</template>
  </template>
</template>
