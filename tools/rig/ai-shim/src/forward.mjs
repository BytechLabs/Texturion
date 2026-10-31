/**
 * What the AI shim does, apart from being a Worker: one `env.AI.run(model,
 * inputs)` becomes one POST to the guard's capped AI route, through the edge.
 *
 * The wire shape mirrors Cloudflare's own REST endpoint for the same call:
 * the body is the model's inputs as JSON, and the answer is the model's
 * output as JSON. The guard runs it on its own AI binding, inside the daily
 * neuron cap and the model allowlist.
 */
import { HEADER } from "../../../rig-protocol/src/index.ts";

/** A Workers AI model id, such as `@cf/meta/llama-3.2-1b-instruct`. */
const MODEL = /^@(?:cf|hf)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * @param {{ url: string, token: string, fetch: typeof fetch }} guard
 *   url: `<edge>/g/ai`, token: the rig's `rig-api` caller token
 */
export async function forwardAiRun(guard, model, inputs, options) {
  if (typeof model !== "string" || !MODEL.test(model)) {
    throw new Error("ai shim: not a Workers AI model id");
  }
  // The app passes none. A caller that starts to would be asking for gateway
  // or streaming behaviour the guard does not provide, so it fails here
  // rather than quietly getting something else.
  if (options !== undefined && options !== null && Object.keys(options).length > 0) {
    throw new Error("ai shim: run options are not forwarded to the guard");
  }
  const response = await guard.fetch(`${guard.url}/run/${model}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${guard.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(inputs ?? {}),
  });
  if (!response.ok) {
    let rule = "";
    if (response.headers.get(HEADER.refusedBy)) {
      try {
        const body = await response.json();
        if (typeof body?.rule === "string") rule = `: ${body.rule}`;
      } catch {
        // the status says enough
      }
      throw new Error(`ai shim: the guard refused (${response.status}${rule})`);
    }
    throw new Error(`ai shim: the guard answered ${response.status}`);
  }
  return response.json();
}
