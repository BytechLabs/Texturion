import type { Ctx } from "./context";
import { sendProductionEvent } from "./sentry";

/**
 * The weekly key inventory (docs/RIG.md). Telnyx
 * keys cannot be scoped, so any key nobody expects is full power over
 * production's numbers and money. The inventory reads every credential the
 * account will list and raises `['ops','telnyx-key-inventory']` on anything
 * outside the accepted baseline.
 *
 * Telnyx publishes no API-key listing (developers.telnyx.com, checked
 * 2026-10-31: the v2 reference has none, and keys are managed in the portal),
 * so three sources stand in for it, each read on its own so one the account
 * refuses does not blind the others:
 *   - GET /v2/api_keys, tried in case the account exposes it, and counted only
 *     when it answers with a list;
 *   - OAuth clients and grants, which are API credentials and are documented;
 *   - the audit log since the last run, for any entry about an API key, OAuth
 *     client or grant. A key made in the portal shows up there if Telnyx
 *     audits key creation (unverified).
 * Only when none of them can be read is the inventory itself the alert.
 */
export interface Inventory {
  api_keys: string[] | null;
  oauth_clients: string[] | null;
  oauth_grants: string[] | null;
  /** Audit-log entries about credentials since the previous run, as `type:id`. */
  audit_findings: string[] | null;
  read_at: number;
}

type Baseline = { api_keys: string[] | null; oauth_clients: string[]; oauth_grants: string[]; accepted_at: number };

interface InventoryState {
  baseline?: Baseline;
  last?: Inventory;
}

const KEY = "key-inventory";
const AUDIT_CREDENTIAL = /api[_ -]?key|oauth|integration_secret/i;

type Item = Record<string, unknown>;

function idsOf(items: Item[], field = "id"): string[] {
  return items
    .map((item) => item[field])
    .filter((value): value is string => typeof value === "string" && value !== "")
    .sort();
}

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export async function readInventory(ctx: Ctx, since: number): Promise<Inventory> {
  const telnyx = ctx.telnyx;
  if (!telnyx) throw new Error("no Telnyx key");

  const api_keys = await attempt(async () => {
    const reply = await telnyx.send("GET", "/v2/api_keys?page[size]=250");
    const items = (reply.body as { data?: unknown } | undefined)?.data;
    return reply.status === 200 && Array.isArray(items) ? idsOf(items as Item[]) : null;
  });
  const oauth_clients = await attempt(async () => idsOf(await telnyx.listAll<Item>("/v2/oauth_clients"), "client_id"));
  const oauth_grants = await attempt(async () => idsOf(await telnyx.listAll<Item>("/v2/oauth_grants")));
  const audit_findings = await attempt(async () =>
    (await telnyx.listAll<Item>("/v2/audit_events", { "filter[created_after]": new Date(since).toISOString() }))
      .filter((entry) => AUDIT_CREDENTIAL.test(String(entry.record_type ?? "")))
      .map((entry) => `${String(entry.record_type)}:${String(entry.resource_id ?? "")}`)
      .sort(),
  );
  if (api_keys === null && oauth_clients === null && oauth_grants === null && audit_findings === null) {
    throw new Error("no inventory source answered");
  }
  return { api_keys, oauth_clients, oauth_grants, audit_findings, read_at: ctx.now() };
}

/** What in an inventory the baseline does not account for. */
export function unexpected(inventory: Inventory, baseline: Baseline | undefined): string[] {
  if (!baseline) return ["no_accepted_baseline"];
  const out: string[] = [];
  for (const id of inventory.api_keys ?? []) if (!baseline.api_keys?.includes(id)) out.push(`api_key:${id}`);
  for (const id of inventory.oauth_clients ?? []) if (!baseline.oauth_clients.includes(id)) out.push(`oauth_client:${id}`);
  for (const id of inventory.oauth_grants ?? []) if (!baseline.oauth_grants.includes(id)) out.push(`oauth_grant:${id}`);
  for (const finding of inventory.audit_findings ?? []) out.push(`audit:${finding}`);
  return out;
}

export async function runKeyInventory(ctx: Ctx): Promise<{ unexpected: string[]; inventory: Inventory | null }> {
  if (!ctx.telnyx) return { unexpected: [], inventory: null };
  const state = (await ctx.store.get<InventoryState>(KEY)) ?? {};
  const since = state.last?.read_at ?? ctx.now() - 8 * 24 * 60 * 60 * 1000;
  let inventory: Inventory;
  try {
    inventory = await readInventory(ctx, since);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await sendProductionEvent(ctx, {
      key: "telnyx-key-inventory",
      summary: "The weekly Telnyx key inventory could not be read",
      detail: `${message.slice(0, 200)}. An unexpected key would go unseen until the guard can read one of its sources.`,
    });
    return { unexpected: ["inventory_unreadable"], inventory: null };
  }
  const found = unexpected(inventory, state.baseline);
  await ctx.store.put(KEY, { ...state, last: inventory } satisfies InventoryState);
  if (found.length > 0) {
    await sendProductionEvent(ctx, {
      key: "telnyx-key-inventory",
      summary:
        found[0] === "no_accepted_baseline"
          ? "The Telnyx key inventory has no accepted baseline"
          : `Unexpected Telnyx credentials: ${found.length}`,
      detail:
        `${found.join(", ")}. Telnyx keys cannot be scoped: any key is full power over the account. ` +
        "Revoke what nobody made on purpose (portal > Auth), then accept the inventory through the guard's " +
        "/admin/key-inventory/accept.",
      level: "error",
    });
  }
  return { unexpected: found, inventory };
}

/** Accepts the last inventory as the baseline, once whoever ran it has checked it. */
export async function acceptInventory(ctx: Ctx): Promise<Baseline | null> {
  const state = (await ctx.store.get<InventoryState>(KEY)) ?? {};
  if (!state.last) return null;
  const baseline: Baseline = {
    api_keys: state.last.api_keys,
    oauth_clients: state.last.oauth_clients ?? [],
    oauth_grants: state.last.oauth_grants ?? [],
    accepted_at: ctx.now(),
  };
  await ctx.store.put(KEY, { ...state, baseline } satisfies InventoryState);
  return baseline;
}
