import { z } from 'zod'
import { createMCPClient } from '@ai-sdk/mcp'
import type { Tool } from 'ai'
import type { ToolResult } from '@devsprint/shared'
import {
  TOOL_DESCRIPTIONS,
  createIssueInputSchema,
  listIssuesInputSchema,
  searchIssuesInputSchema,
  updateIssueStatusInputSchema,
} from '@devsprint/shared/tools'

/**
 * The four issue tools, sourced over MCP instead of defined locally.
 *
 * This is the half of ADR-0002 that makes the app itself an MCP client: the
 * agent calls `apps/mcp-issues` for these, exactly as an external host does, so
 * the two clients exercise one code path rather than two implementations that
 * drift.
 */
const ISSUE_TOOLS = [
  { name: 'list_issues', schema: listIssuesInputSchema, gated: false },
  { name: 'search_issues', schema: searchIssuesInputSchema, gated: false },
  { name: 'create_issue', schema: createIssueInputSchema, gated: true },
  { name: 'update_issue_status', schema: updateIssueStatusInputSchema, gated: true },
] as const

export const MCP_ISSUE_TOOL_NAMES = ISSUE_TOOLS.map((tool) => tool.name)

/**
 * ADR-0002 asks for vendored tool definitions rather than a `tools/list` at
 * startup, so a server that is slow or briefly down cannot change what the
 * agent can do. Building them from the schemas we already own gives that
 * stability without a codegen step, and without a second copy to drift.
 *
 * (The ADR names `mcp-to-ai-sdk` for this. That package targets the previous
 * major of the AI SDK and its generated tools return strings, so it is not
 * usable here.)
 */
function vendoredDefinitions() {
  return {
    tools: ISSUE_TOOLS.map((tool) => ({
      name: tool.name,
      description: TOOL_DESCRIPTIONS[tool.name],
      inputSchema: z.toJSONSchema(tool.schema) as { type: 'object' },
    })),
  }
}

/** Our zod schemas, so the SDK builds typed tools rather than dynamic ones. */
function schemaMap() {
  return Object.fromEntries(ISSUE_TOOLS.map((tool) => [tool.name, { inputSchema: tool.schema }]))
}

function malformed(message: string): ToolResult<never> {
  return { ok: false, error: { code: 'INVALID_INPUT', message } }
}

/** Valid JSON is not enough — it has to be our envelope, or `.ok` reads undefined. */
function isEnvelope(value: unknown): value is ToolResult<unknown> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  const candidate = value as { ok: unknown; data?: unknown; error?: unknown }
  if (candidate.ok === true) return 'data' in candidate
  if (candidate.ok === false) {
    return (
      typeof candidate.error === 'object' && candidate.error !== null && 'code' in candidate.error
    )
  }
  return false
}

/**
 * MCP hands back a `CallToolResult`, with our envelope as JSON inside a text
 * block. Left alone, "behaves identically behind MCP" would be false: every
 * `result.ok` check in the SPA reads undefined and the Phase 7 cards have
 * nothing to render, while the model still sees readable JSON and answers
 * plausibly — a failure that hides rather than announces itself.
 */
export function unwrapEnvelope(output: unknown): ToolResult<unknown> {
  const content =
    typeof output === 'object' && output !== null && 'content' in output
      ? (output as { content?: unknown }).content
      : undefined
  const first = Array.isArray(content) ? (content[0] as { text?: unknown } | undefined) : undefined

  if (typeof first?.text !== 'string') return malformed('Malformed MCP tool result.')

  let parsed: unknown
  try {
    parsed = JSON.parse(first.text)
  } catch {
    return malformed('MCP tool result was not valid JSON.')
  }
  // A shape check, not just a parse: JSON that is valid but not our envelope
  // would sail through and reintroduce the silent failure this exists to stop.
  if (!isEnvelope(parsed)) return malformed('MCP tool result was not a DevSprint tool envelope.')
  return parsed
}

export interface McpIssueToolsOptions {
  /**
   * How to reach the issues server. In the Worker this is a service binding's
   * fetch, so the call never leaves Cloudflare's network.
   */
  fetch: typeof globalThis.fetch
  /** Only used to form a URL; a service binding ignores the host. */
  url?: string
}

/**
 * Builds the issue tools from the MCP server, preserving the two things Phase 5
 * depends on: the write tools stay gated, and every tool still returns the
 * shared result envelope.
 */
/**
 * Wraps the SDK's tools so the pair of guarantees Phase 5 and the SPA rely on
 * survive the hop: writes stay gated, and results stay in the shared envelope.
 */
export function adaptRemoteTools(remote: Record<string, unknown>): Record<string, Tool> {
  return Object.fromEntries(
    ISSUE_TOOLS.map((tool) => {
      const source = remote[tool.name] as
        (Tool & { execute?: (input: unknown, options: unknown) => Promise<unknown> }) | undefined
      // Fail while building rather than mid-turn: a definition mismatch or an
      // SDK change should reach the caller's fallback, not surface as a broken
      // tool call once the model has already reached for it.
      if (typeof source?.execute !== 'function') {
        throw new Error(`MCP server did not provide a usable '${tool.name}' tool.`)
      }
      const execute = source.execute
      return [
        tool.name,
        {
          ...source,
          // Approval policy is ours, not the server's: an MCP-sourced tool is a
          // normal tool to the SDK, so the Phase 5 gate keeps working unchanged
          // (ADR-0003).
          ...(tool.gated ? { needsApproval: true as const } : {}),
          execute: async (input: unknown, options: unknown) =>
            unwrapEnvelope(await execute(input, options)),
        },
      ]
    }),
  )
}

/**
 * Builds the issue tools from the MCP server, preserving the two things Phase 5
 * depends on: the write tools stay gated, and every tool still returns the
 * shared result envelope.
 */
export async function createMcpIssueTools({
  fetch,
  url = 'https://devsprint-mcp-issues/mcp',
}: McpIssueToolsOptions): Promise<Record<string, Tool>> {
  const client = await createMCPClient({ transport: { type: 'http', url, fetch } })
  return adaptRemoteTools(
    client.toolsFromDefinitions(vendoredDefinitions(), { schemas: schemaMap() }),
  )
}
