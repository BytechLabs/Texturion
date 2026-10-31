import { hasControlClass } from "./auth";
import { uplink, type Env } from "./env";
import { boundedText, empty, json } from "./http";
import type { RpcOutcome } from "./uplink";

/** `/ctl/*`: the rig's own uplink, triage's rpc, and the sealed secret bundle. */

const RPC_MAX_BYTES = 64 * 1024;
const BUNDLE_MAX_PARTS = 8;

export async function handleUplink(env: Env, request: Request): Promise<Response> {
  if (!(await hasControlClass(env, request, "rig"))) return empty(401);
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return empty(426);
  return uplink(env).fetch(request);
}

export async function handleRpc(env: Env, request: Request): Promise<Response> {
  if (!(await hasControlClass(env, request, "triage"))) return empty(401);
  const raw = await boundedText(request, RPC_MAX_BYTES);
  if (raw === null) return empty(413);
  let call: { method?: unknown; params?: unknown };
  try {
    call = JSON.parse(raw) as typeof call;
  } catch {
    return json(400, { error: "body must be JSON" });
  }
  if (typeof call.method !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/i.test(call.method)) {
    return json(400, { error: "method must be a short name" });
  }
  // The stub's RPC typing cannot carry `result: unknown`; the value itself
  // crosses intact.
  const outcome = (await uplink(env).rigRpc(call.method, call.params ?? null, "triage")) as unknown as RpcOutcome;
  switch (outcome.status) {
    case "ok":
      return json(200, { ok: true, result: outcome.result });
    case "error":
      return json(502, { ok: false, error: outcome.error });
    case "offline":
      return json(503, { ok: false, error: "rig_offline" });
    case "timeout":
      return json(504, { ok: false, error: "rig_timeout" });
  }
}

/**
 * The sealed bundle, reassembled from its parts, or null. The edge cannot
 * open it: it is sealed to the rig's own key (scripts/seal-bundle.mjs).
 */
export function sealedBundle(env: Env): string | null {
  const parts = Number(env.RIG_SECRET_BUNDLE_PARTS ?? "");
  if (!Number.isInteger(parts) || parts < 1 || parts > BUNDLE_MAX_PARTS) return null;
  let bundle = "";
  for (let i = 1; i <= parts; i++) {
    const part = (env as unknown as Record<string, string | undefined>)[`RIG_SECRET_BUNDLE_${i}`];
    if (!part) return null;
    bundle += part;
  }
  try {
    const parsed = JSON.parse(bundle) as { v?: unknown; ct?: unknown };
    return parsed.v === 1 && typeof parsed.ct === "string" ? bundle : null;
  } catch {
    return null;
  }
}

export async function handleSecrets(env: Env, request: Request): Promise<Response> {
  if (!(await hasControlClass(env, request, "rig"))) return empty(401);
  const bundle = sealedBundle(env);
  if (!bundle) return json(503, { error: "bundle_absent" });
  return new Response(bundle, { status: 200, headers: { "content-type": "application/json" } });
}
