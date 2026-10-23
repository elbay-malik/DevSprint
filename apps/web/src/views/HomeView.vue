<script setup lang="ts">
import AppHeader from '@/features/workspace/components/AppHeader.vue'
import WorkspacePane from '@/features/workspace/components/WorkspacePane.vue'
import ChatPane from '@/features/chat/components/ChatPane.vue'
</script>

<template>
  <!-- From lg up the two panes share a locked viewport and scroll on their own.
       Below it they stack and the page scrolls: the board flows at its natural
       height, and the copilot gets a full screen of its own after it. -->
  <div class="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] lg:h-dvh">
    <AppHeader />
    <main
      class="grid grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:divide-x"
    >
      <WorkspacePane />
      <ChatPane />
    </main>
  </div>
</template>
