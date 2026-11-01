import { globalIgnores } from 'eslint/config'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  { name: 'app/files-to-lint', files: ['**/*.{ts,mts,vue}'] },
  globalIgnores([
    '**/dist/**',
    '**/dist-e2e/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/.wrangler/**',
    '**/worker-configuration.d.ts',
    '**/test-results/**',
    '**/playwright-report/**',
  ]),
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommendedTypeChecked,
  {
    // Vendored shadcn-vue registry components follow the registry's naming
    // and prop conventions, not ours.
    name: 'app/shadcn-ui-overrides',
    files: ['**/src/components/ui/**'],
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
    },
  },
  skipFormatting,
)
