/** Node's stand-in for `cloudflare:workers`: enough for src/index.ts to load. */
export class DurableObject<Env = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: Env,
  ) {}
}
