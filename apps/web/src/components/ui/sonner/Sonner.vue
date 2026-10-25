<script lang="ts" setup>
import { computed } from 'vue'
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
  XIcon,
} from '@lucide/vue'

import type { ToasterProps } from 'vue-sonner'
import { Toaster as Sonner } from 'vue-sonner'
// vue-sonner ships its layout and positioning as a separate stylesheet, and
// without it every toast rendered as a plain list item below the fixed app
// grid, one viewport down, where nobody saw it.
import 'vue-sonner/style.css'
import { resolvedTheme, theme as appTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const props = defineProps<ToasterProps>()

// Left unset, sonner pins itself to 'light', and its description, close-button
// and invert rules then fight the .dark tokens. It follows the app's theme.
const toasterTheme = computed(() => props.theme ?? resolvedTheme(appTheme.value))
</script>

<template>
  <Sonner
    v-bind="props"
    :theme="toasterTheme"
    :class="cn('toaster group', props.class)"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
      '--gray2': 'color-mix(in oklch, var(--popover) 90%, transparent)',
      '--gray3': 'var(--border)',
      '--gray4': 'var(--border)',
      '--gray5': 'var(--border)',
      '--gray12': 'var(--popover-foreground)',
    }"
    :toast-options="{
      classes: {
        toast: 'rounded-xl',
        // sonner colours the description with its own hex greys; secondary
        // text here is Graphite, like everywhere else. `!` because sonner's
        // stylesheet is unlayered and outranks the utilities layer.
        description: 'text-muted-foreground!',
      },
      ...props.toastOptions,
    }"
  >
    <template #success-icon>
      <CircleCheckIcon class="size-4" />
    </template>
    <template #info-icon>
      <InfoIcon class="size-4" />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon class="size-4" />
    </template>
    <template #error-icon>
      <OctagonXIcon class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <Loader2Icon class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Sonner>
</template>
