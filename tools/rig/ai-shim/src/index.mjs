/**
 * The rig's stand-in for the Workers AI binding.
 *
 * `wrangler dev` cannot emulate Workers AI, so with the real binding it would
 * open a remote session and bill the production account's AI pool. The rig's
 * derived config binds `AI` to this entrypoint instead, over a service
 * binding, and the app's `env.AI.run(model, inputs)` arrives here as RPC.
 */
import { WorkerEntrypoint } from "cloudflare:workers";

import { forwardAiRun } from "./forward.mjs";

export class AiShim extends WorkerEntrypoint {
  async run(model, inputs, options) {
    return forwardAiRun(
      { url: this.env.GUARD_AI_URL, token: this.env.GUARD_TOKEN, fetch: (url, init) => fetch(url, init) },
      model,
      inputs,
      options,
    );
  }
}

export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
};
