import { EDGE_CALLER, HEADER } from "@loonext/rig-protocol";

import { TELNYX_CLASSES_BY_CALLER, type GuardCaller } from "../caller";
import type { Ctx } from "../context";
import { json, Refusal, type RuleName } from "../refusal";
import { requireSafe } from "../setup/safety";
import { AccountRefused, readBalance } from "../state/balance";
import { handleDial } from "./dial";
import { relay, type Handler, type TelnyxRequest } from "./forward";
import { handleLegCommand } from "./leg-command";
import { handleMessage } from "./message";
import { loadPartition } from "./partition";
import { handleProvisioning } from "./provisioning";
import { handleRead } from "./read";
import { isCleanPath, matchEndpoint, type PolicyEntry } from "./registry";

/**
 * Account-wide areas, refused whatever the registry says and before anything
 * else is looked at (docs/RIG.md). A read in one of them answers
 * for the whole account, production included; a write acts on all of it.
 */
const ACCOUNT_WIDE: readonly { prefix: string; rule: RuleName }[] = [
  { prefix: "/v2/10dlc", rule: "refused.10dlc" },
  { prefix: "/v2/porting_orders", rule: "refused.porting" },
  { prefix: "/v2/portability_checks", rule: "refused.porting" },
  { prefix: "/v2/porting", rule: "refused.porting" },
  { prefix: "/v2/messaging_hosted_", rule: "refused.hosted_messaging" },
  { prefix: "/v2/verifications", rule: "refused.verification" },
  { prefix: "/v2/verify_profiles", rule: "refused.verification" },
  { prefix: "/v2/verified_numbers", rule: "refused.verification" },
  { prefix: "/v2/api_keys", rule: "refused.api_keys" },
  { prefix: "/v2/integration_secrets", rule: "refused.api_keys" },
  { prefix: "/v2/oauth_clients", rule: "refused.api_keys" },
  { prefix: "/v2/oauth_grants", rule: "refused.api_keys" },
  { prefix: "/v2/managed_accounts", rule: "refused.managed_accounts" },
  { prefix: "/v2/payment", rule: "refused.auto_recharge" },
];

/** Partition resources only the setup routine may write. */
const SETUP_ONLY = [
  "/v2/outbound_voice_profiles",
  "/v2/call_control_applications",
  "/v2/credential_connections",
  "/v2/billing_groups",
  "/v2/notification_",
  "/v2/messaging_profiles/",
];

function underPrefix(path: string, prefix: string): boolean {
  return prefix.endsWith("_") || prefix.endsWith("/")
    ? path.startsWith(prefix)
    : path === prefix || path.startsWith(`${prefix}/`);
}

export function accountWideRule(method: string, path: string): RuleName | null {
  const area = ACCOUNT_WIDE.find((item) => underPrefix(path, item.prefix));
  if (area) return method === "GET" ? "read.account_wide" : area.rule;
  if (method !== "GET" && SETUP_ONLY.some((prefix) => underPrefix(path, prefix))) return "refused.setup_only";
  return null;
}

/** The rule for a registry entry of class `refused`, by the area it is in. */
export function refusedRule(entry: PolicyEntry): RuleName {
  if (entry.path.startsWith("/v2/documents")) return "refused.documents";
  return accountWideRule("POST", entry.path) ?? "refused.registry";
}

export const CLASS_HANDLERS: Readonly<Record<string, Handler>> = {
  read: handleRead,
  "leg-command": handleLegCommand,
  dial: handleDial,
  message: handleMessage,
  provisioning: handleProvisioning,
};

export async function handleTelnyx(ctx: Ctx, request: Request, caller: GuardCaller, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  const path = url.pathname.slice("/telnyx".length);
  if (!isCleanPath(path)) throw new Refusal("request.malformed_path");

  const wide = accountWideRule(method, path);
  if (wide) throw new Refusal(wide);
  if (!ctx.telnyx) throw new Refusal("telnyx.key_missing");

  // The balance, as a number and nothing else: how the edge corroborates a
  // low-balance notice, and how rigd shows the floor. Telnyx refusing the
  // read is passed on as Telnyx's own answer, with no refused-by header,
  // because that refusal is itself the edge's evidence of a disabled account.
  if (method === "GET" && path === "/v2/balance") {
    try {
      return json({ data: { balance: await readBalance(ctx) } });
    } catch (cause) {
      if (cause instanceof AccountRefused) return relay(cause.reply);
      throw cause;
    }
  }
  if (caller === EDGE_CALLER) {
    // The account's notification event types: names and switches, no data.
    // The edge matches a notice against them before it halts anything.
    if (method !== "GET" || path !== "/v2/notification_events") throw new Refusal("class.not_allowed");
    const query = url.search;
    return relay(await ctx.telnyx.send("GET", `${path}${query}`));
  }

  const matched = matchEndpoint(method, path);
  if (!matched) throw new Refusal("registry.missing");
  const { entry, ids } = matched;
  if (entry.policy === "refused") throw new Refusal(refusedRule(entry));
  if (!TELNYX_CLASSES_BY_CALLER[caller].has(entry.policy)) throw new Refusal("class.not_allowed");

  await requireSafe(ctx);
  const view = await loadPartition(ctx);

  const text = method === "GET" || method === "DELETE" ? "" : await request.text();
  let body: Record<string, unknown> | undefined;
  let bodyInvalid = false;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      else bodyInvalid = true;
    } catch {
      bodyInvalid = true;
    }
  }
  if (bodyInvalid && entry.policy !== "leg-command") throw new Refusal("request.body_invalid");

  const telnyxRequest: TelnyxRequest = {
    ctx,
    caller,
    method,
    path,
    query: new URLSearchParams(url.search),
    ids,
    entry,
    body,
    bodyInvalid,
    lease: request.headers.get(HEADER.lease),
    idempotencyKey: request.headers.get("idempotency-key"),
    view,
  };
  const handler = CLASS_HANDLERS[entry.policy];
  if (!handler) throw new Refusal("registry.missing");
  return handler(telnyxRequest);
}
