/**
 * `cloudflare:workers` only exists inside workerd, and the unit suite runs in
 * node. The Durable Object class is never constructed there — tests drive the
 * tool layer through the in-memory workspace instead — so a base class with the
 * right shape is enough to let the module import.
 */
export class DurableObject<Env = unknown> {
  constructor(
    protected ctx: unknown,
    protected env: Env,
  ) {}
}
