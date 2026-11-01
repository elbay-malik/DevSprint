import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // Off for the browser suite (e2e/servers.ts). Tailwind reloads every open page
  // when a file it scans changes, even one no page imports, and a reload empties
  // the transcript under whichever test is running.
  server: { hmr: process.env.E2E_NO_HMR !== '1' },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
