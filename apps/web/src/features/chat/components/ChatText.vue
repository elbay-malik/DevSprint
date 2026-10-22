<script setup lang="ts">
import { computed } from 'vue'
import { parseChatText } from '../lib/chat-text'
import ChatInline from './ChatInline.vue'

/**
 * An assistant's text, with the markdown subset it actually writes shown as
 * formatting rather than raw `**` and pipes (ADR-0022). Every string is
 * interpolated, never injected: there is no `v-html` here, and no links.
 */
const props = defineProps<{ text: string }>()

const blocks = computed(() => parseChatText(props.text))
</script>

<template>
  <div data-testid="chat-text" class="flex flex-col gap-2 break-words">
    <template v-for="(block, index) in blocks" :key="index">
      <p v-if="block.kind === 'paragraph'">
        <template v-for="(line, lineIndex) in block.lines" :key="lineIndex">
          <br v-if="lineIndex > 0" />
          <ChatInline :parts="line" />
        </template>
      </p>
      <p v-else-if="block.kind === 'heading'" class="font-semibold">
        <ChatInline :parts="block.content" />
      </p>
      <ol v-else-if="block.kind === 'list' && block.ordered" class="list-decimal pl-5">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <ChatInline :parts="item" />
        </li>
      </ol>
      <ul v-else-if="block.kind === 'list'" class="list-disc pl-5">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <ChatInline :parts="item" />
        </li>
      </ul>
      <div v-else-if="block.kind === 'table'" class="overflow-x-auto">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr class="border-b">
              <th
                v-for="(cell, cellIndex) in block.header"
                :key="cellIndex"
                class="px-2 py-1 text-left font-medium"
              >
                <ChatInline :parts="cell" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in block.rows"
              :key="rowIndex"
              class="border-b last:border-0"
            >
              <td v-for="(cell, cellIndex) in row" :key="cellIndex" class="px-2 py-1 align-top">
                <ChatInline :parts="cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
