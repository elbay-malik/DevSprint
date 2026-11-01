/**
 * `cloudflare:workers` only exists inside workerd, and the unit suite runs in
 * node. The tests drive both entrypoints, so the base class only has to keep the
 * `env` that `Internal` reads, as the real one does.
 */
export class WorkerEntrypoint {
  protected ctx: unknown
  protected env: unknown

  constructor(ctx: unknown, env: unknown) {
    this.ctx = ctx
    this.env = env
  }
}
