import type { UIDataTypes, UIMessage } from 'ai'
import type { DevSprintUITools } from '@devsprint/shared/tools'

/**
 * The SPA's typed UI message: no metadata, no custom data parts yet (the
 * Phase 7/8 rich cards add them), and the six read tools from the shared
 * contract so `tool-<name>` parts carry typed `input` / `output`.
 *
 * `DevSprintUITools` is a type-only import on purpose — the shared `tools`
 * subpath pulls in zod at runtime, which the SPA must not ship.
 */
export type DevSprintUIMessage = UIMessage<never, UIDataTypes, DevSprintUITools>
