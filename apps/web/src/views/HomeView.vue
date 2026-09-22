<script setup lang="ts">
import AppHeader from '@/features/workspace/components/AppHeader.vue'
import WorkspacePane from '@/features/workspace/components/WorkspacePane.vue'
import ChatPane from '@/features/chat/components/ChatPane.vue'
</script>

<template>
  <div class="grid h-dvh grid-rows-[auto_minmax(0,1fr)]">
    <AppHeader />
    <main
      class="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:divide-x"
    >
      <WorkspacePane />
      <ChatPane />
    </main>
  </div>
</template>
