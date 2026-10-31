import { DurableObject } from "cloudflare:workers";
import { HEADER } from "@loonext/rig-protocol";

import { parseCaller } from "./caller";
import type { Ctx } from "./context";
import { readConfig, type Env } from "./env";
import { Guard } from "./guard";
import { refuse } from "./refusal";
import { durableStore } from "./store";
import { telnyxApi } from "./telnyx/client";

/**
 * `loonext-telnyx-guard` (D142, docs/RIG.md). No public URL: the
 * edge's service binding is the only way in, so the caller-class header the
 * edge sets is trusted, and a request without a known class is refused before
 * anything else runs.
 */
export class GuardState extends DurableObject<Env> {
  private readonly guard: Guard;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    const config = readConfig(env);
    const outbound: typeof fetch = (input, init) => fetch(input, init);
    const ctx: Ctx = {
      config,
      store: durableStore(state.storage),
      now: () => Date.now(),
      fetch: outbound,
      telnyx: config.telnyxKey ? telnyxApi(config.telnyxKey, outbound) : null,
      ai: env.AI ? { run: (model, inputs) => env.AI!.run(model as never, inputs as never) } : null,
      edge: env.EDGE ?? null,
      versionId: env.CF_VERSION_METADATA?.id ?? "unversioned",
      setAlarm: async (at) => {
        await state.storage.setAlarm(at);
      },
      memory: {},
    };
    this.guard = new Guard(ctx);
  }

  override fetch(request: Request): Promise<Response> {
    return this.guard.handle(request);
  }

  override alarm(): Promise<void> {
    return this.guard.alarm();
  }

  cron(expression: string): Promise<void> {
    return this.guard.cron(expression);
  }
}

/** The one instance: every count and lease is decided in one place. */
function stub(env: Env): DurableObjectStub<GuardState> {
  return env.GUARD.get(env.GUARD.idFromName("guard"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!parseCaller(request.headers.get(HEADER.callerClass))) return refuse("class.unknown");
    return stub(env).fetch(request);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(stub(env).cron(event.cron));
  },
} satisfies ExportedHandler<Env>;
