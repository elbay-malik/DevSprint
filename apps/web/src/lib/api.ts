import { API_ROUTES } from '@devsprint/shared'

/** Empty base means same-origin relative paths (SPA and api colocated). */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''

export const CHAT_ENDPOINT = `${API_BASE_URL}${API_ROUTES.chat}`
export const WORKSPACE_ENDPOINT = `${API_BASE_URL}${API_ROUTES.workspace}`
export const WORKSPACE_RESET_ENDPOINT = `${API_BASE_URL}${API_ROUTES.workspaceReset}`
/** `POST { changeId }` here to undo an approved board write; see the route's own note. */
export const WORKSPACE_UNDO_ENDPOINT = `${API_BASE_URL}${API_ROUTES.workspaceUndo}`

/** `POST` here to cancel a running deployment; see the route's own note. */
export const deploymentCancelEndpoint = (deploymentId: string) =>
  `${API_BASE_URL}${API_ROUTES.deploymentCancel.replace(':id', encodeURIComponent(deploymentId))}`

/**
 * The public issues MCP server (scenario S-F), which serves this same board to
 * any outside MCP client. The empty transcript shows it, and hides the line
 * when a build leaves it unset.
 */
export const MCP_ENDPOINT = import.meta.env.VITE_MCP_URL ?? ''
