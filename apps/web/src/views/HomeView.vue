<script setup lang="ts">
import WorkspacePane from '@/features/workspace/components/WorkspacePane.vue'
import ChatPane from '@/features/chat/components/ChatPane.vue'
</script>

<template>
  <main class="grid h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:divide-x">
    <WorkspacePane />
    <ChatPane />
  </main>
</template>
