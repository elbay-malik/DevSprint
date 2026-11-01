/**
 * `cloudflare:workers` only exists inside workerd, and the unit suite runs in
 * node. The tests drive the public `fetch` handler, so a base class is enough to
 * let `src/index.ts` import.
 */
export class WorkerEntrypoint {}
