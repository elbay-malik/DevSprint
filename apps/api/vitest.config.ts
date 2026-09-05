import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // See test/cloudflare-workers-stub.ts.
      'cloudflare:workers': path.resolve(import.meta.dirname, 'test/cloudflare-workers-stub.ts'),
    },
  },
  test: { include: ['src/**/*.{test,spec}.ts'] },
})
