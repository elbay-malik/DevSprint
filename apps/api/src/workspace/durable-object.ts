import { DurableObject } from 'cloudflare:workers'
import { createWorkspaceSeed, type Workspace } from '@devsprint/shared'
import type {
  WorkspaceApi,
  CreateIssueInput,
  CreateReleaseNotesInput,
  DiffReleaseNotesInput,
  GetBurndownInput,
  GetDeploymentHistoryInput,
  GetSprintStatusInput,
  ListIssuesInput,
  SearchIssuesInput,
  UpdateIssueStatusInput,
} from '@devsprint/shared/tools'
import {
  diffReleaseNotes,
  getBurndown,
  getDeploymentHistory,
  getSprintStatus,
  listIssues,
  searchIssues,
} from './queries'
import { createIssue, createReleaseNotes, updateIssueStatus } from './mutations'

const STORAGE_KEY = 'workspace'

/**
 * The one copy of the workspace.
 *
 * Until Phase 6 this was a module singleton, which was fine while a single
 * Worker owned every read and write. The public MCP server breaks that
 * assumption: two Workers, in different isolates, must see the same board, or
 * scenario S-F's "same workspace, two clients" is not true. A Durable Object is
 * the smallest thing that makes it true both locally and deployed.
 *
 * It also makes the write path correct rather than merely lucky. Allocating the
 * next `DS-<n>` key is a read-modify-write, and a Durable Object serialises
 * calls, so two clients filing an issue at once cannot both claim DS-14.
 *
 * The query and mutation functions are untouched: they are still pure functions
 * over a snapshot, they just run in here now.
 */
export class WorkspaceDO extends DurableObject implements WorkspaceApi {
  /** Cached between calls; storage is the source of truth across restarts. */
  private workspace: Workspace | undefined

  private async load(): Promise<Workspace> {
    this.workspace ??= (await this.ctx.storage.get<Workspace>(STORAGE_KEY)) ?? createWorkspaceSeed()
    return this.workspace
  }

  /** Persists after anything that mutates, so a restart keeps approved writes. */
  private async save(workspace: Workspace): Promise<void> {
    this.workspace = workspace
    await this.ctx.storage.put(STORAGE_KEY, workspace)
  }

  async snapshot(): Promise<Workspace> {
    return await this.load()
  }

  async reset(): Promise<Workspace> {
    const seeded = createWorkspaceSeed()
    await this.save(seeded)
    return seeded
  }

  // --- reads ------------------------------------------------------------------

  async listIssues(input: ListIssuesInput) {
    return listIssues(await this.load(), input)
  }

  async searchIssues(input: SearchIssuesInput) {
    return searchIssues(await this.load(), input)
  }

  async getSprintStatus(input: GetSprintStatusInput) {
    return getSprintStatus(await this.load(), input)
  }

  async getDeploymentHistory(input: GetDeploymentHistoryInput) {
    return getDeploymentHistory(await this.load(), input)
  }

  async getBurndown(input: GetBurndownInput) {
    return getBurndown(await this.load(), input)
  }

  async diffReleaseNotes(input: DiffReleaseNotesInput) {
    return diffReleaseNotes(await this.load(), input)
  }

  // --- writes -----------------------------------------------------------------
  //
  // Each mutates the loaded workspace and persists it. Failures return the error
  // envelope without touching storage, so a rejected write leaves no trace.

  async createIssue(input: CreateIssueInput) {
    const workspace = await this.load()
    const result = createIssue(workspace, input)
    if (result.ok) await this.save(workspace)
    return result
  }

  async updateIssueStatus(input: UpdateIssueStatusInput) {
    const workspace = await this.load()
    const result = updateIssueStatus(workspace, input)
    if (result.ok) await this.save(workspace)
    return result
  }

  async createReleaseNotes(input: CreateReleaseNotesInput) {
    const workspace = await this.load()
    const result = createReleaseNotes(workspace, input)
    if (result.ok) await this.save(workspace)
    return result
  }
}

/** Every client talks to the same instance — there is one demo workspace. */
export const WORKSPACE_DO_NAME = 'demo'

export interface WorkspaceBinding {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub<WorkspaceDO>
}

/**
 * Handle to the shared workspace. Phase 9 turns the name into a per-visitor
 * session key, which is why callers go through this rather than inlining it.
 */
export function workspaceStub(binding: WorkspaceBinding): DurableObjectStub<WorkspaceDO> {
  return binding.get(binding.idFromName(WORKSPACE_DO_NAME))
}

export type { WorkspaceApi }
