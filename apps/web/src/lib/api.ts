import { API_ROUTES } from '@devsprint/shared'

/** Empty base means same-origin relative paths (SPA and api colocated). */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''

export const CHAT_ENDPOINT = `${API_BASE_URL}${API_ROUTES.chat}`
export const WORKSPACE_ENDPOINT = `${API_BASE_URL}${API_ROUTES.workspace}`
