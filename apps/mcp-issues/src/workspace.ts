import type { WorkspaceApi } from '@devsprint/shared/tools'

/**
 * The issues server owns no state. It reaches the one workspace through the
 * Durable Object defined in `apps/api` and bound here cross-script, which is
 * what makes scenario S-F's "same workspace, two clients" true: a write from an
 * external MCP host and a read from the SPA hit the same object.
 */
export const WORKSPACE_DO_NAME = 'demo'

/**
 * The class lives in another Worker, so `wrangler types` cannot see its methods
 * and types the stub as `unknown`. The cast is where that gap is crossed; the
 * shared `WorkspaceApi` interface is what keeps both sides honest about it.
 */
export function workspaceOf(binding: DurableObjectNamespace): WorkspaceApi {
  return binding.get(binding.idFromName(WORKSPACE_DO_NAME)) as unknown as WorkspaceApi
}
