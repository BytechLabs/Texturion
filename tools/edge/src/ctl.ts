import { RIG_PRODUCTION_ALERTS, type RigAlert, type RigProductionAlert } from "@loonext/rig-protocol";

import { hasControlClass } from "./auth";
import { RETRY_FAILED_AFTER_MS } from "./deadman";
import { uplink, type Env } from "./env";
import { boundedText, empty, json } from "./http";
import { parseDsn, sendSentryEvent } from "./sentry";
import type { RpcOutcome } from "./uplink";

/** `/ctl/*`: the rig's own uplink, triage's rpc, rigd's production alerts, and the sealed secret bundle. */

const RPC_MAX_BYTES = 64 * 1024;
const BUNDLE_MAX_PARTS = 8;
const ALERT_MAX_BYTES = 8 * 1024;
/** rigd asks every hour while a fault lasts; production hears of it four times a day. */
export const ALERT_REPEAT_MS = 6 * 60 * 60 * 1000;

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

/**
 * rigd's production alerts. The box has no production DSN, so the edge sends
 * them as it sends the dead-man's dark alert: by DSN, from its own production
 * budget, at most once per key every {@link ALERT_REPEAT_MS}, and only for a
 * key the protocol lists. Any answer but 200 means production did not get
 * it, and rigd reports that as its own infrastructure fault.
 */
export async function handleAlert(env: Env, request: Request): Promise<Response> {
  if (!(await hasControlClass(env, request, "rig"))) return empty(401);
  const raw = await boundedText(request, ALERT_MAX_BYTES);
  if (raw === null) return empty(413);
  let alert: Partial<Record<keyof RigAlert, unknown>>;
  try {
    alert = JSON.parse(raw) as typeof alert;
  } catch {
    return json(400, { error: "body must be JSON" });
  }
  if (!RIG_PRODUCTION_ALERTS.includes(alert.key as RigProductionAlert)) return json(400, { error: "not a rig production alert" });
  if (typeof alert.message !== "string" || alert.message === "" || alert.message.length > 500) {
    return json(400, { error: "message must be 1 to 500 characters" });
  }
  if (alert.detail !== undefined && (typeof alert.detail !== "string" || alert.detail.length > 2_000)) {
    return json(400, { error: "detail must be at most 2,000 characters" });
  }
  const key = alert.key as RigProductionAlert;
  const name = `rig:${key}`;
  const rig = uplink(env);
  if (!parseDsn(env.SENTRY_PROD_DSN)) {
    await rig.bump(`alert.no_dsn.${key}`);
    return json(503, { error: "no_production_dsn" });
  }
  const now = Date.now();
  const view = await rig.deadman();
  if (now - (view.alerts[name] ?? 0) < ALERT_REPEAT_MS) return json(200, { sent: false, reason: "repeat" });
  if (now - (view.failures[name] ?? 0) < RETRY_FAILED_AFTER_MS) return json(503, { error: "retry_later" });
  if (!(await rig.takeSentryBudget(now, "production"))) return json(429, { error: "budget_spent" });
  const sent = await sendSentryEvent(env.SENTRY_PROD_DSN, {
    fingerprint: ["ops", key],
    level: "error",
    environment: "production",
    edgeSha: env.GIT_SHA,
    message: alert.message,
    tags: { raised_by: "rigd" },
    extra: alert.detail === undefined ? {} : { detail: alert.detail },
  });
  if (!sent) {
    await rig.noteAlertFailed(name, now);
    return json(502, { error: "sentry_refused" });
  }
  await rig.noteAlert(name, now);
  return json(200, { sent: true });
}

export async function handleSecrets(env: Env, request: Request): Promise<Response> {
  if (!(await hasControlClass(env, request, "rig"))) return empty(401);
  const bundle = sealedBundle(env);
  if (!bundle) return json(503, { error: "bundle_absent" });
  return new Response(bundle, { status: 200, headers: { "content-type": "application/json" } });
}
