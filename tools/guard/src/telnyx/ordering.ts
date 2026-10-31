import type { Ctx } from "../context";
import {
  PARTITION_CAPABILITY,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_HEALTH_CACHE_MS,
} from "../limits";
import { Refusal } from "../refusal";
import { sendProductionEvent } from "../sentry";
import { invalidateOwned, KEYS, type PartitionRecord } from "./partition";

/**
 * Number ordering (docs/RIG.md). Production's sweep
 * lists the whole account and can DELETE, and it acts only on numbers with no
 * billing group once Phase 0a ships. So nothing is ordered until production's
 * /health says the rule is live, and FA0 has stated the call limit. The first
 * order is then read back: if Telnyx did not keep the group, the number is
 * released at once and ordering stops for good.
 */
interface ProductionHealth {
  capable: boolean;
  checked_at: number;
}

export interface FirstOrder {
  state: "pending" | "verified";
  order_id: string | null;
  phone_number: string;
  at: number;
}

export const ORDER_KEYS = {
  health: "production:health",
  first: "orders:first",
  stopped: "orders:stopped",
  last: "orders:last",
} as const;

export async function productionCapable(ctx: Ctx): Promise<boolean> {
  const cached = await ctx.store.get<ProductionHealth>(ORDER_KEYS.health);
  if (cached && ctx.now() - cached.checked_at < PRODUCTION_HEALTH_CACHE_MS) return cached.capable;
  let capable = false;
  try {
    const response = await ctx.fetch(`${PRODUCTION_API_ORIGIN}/health`, { headers: { accept: "application/json" } });
    const body = (await response.json().catch(() => null)) as { capabilities?: unknown } | null;
    capable =
      response.ok && Array.isArray(body?.capabilities) && (body.capabilities as unknown[]).includes(PARTITION_CAPABILITY);
  } catch {
    capable = false;
  }
  await ctx.store.put(ORDER_KEYS.health, { capable, checked_at: ctx.now() } satisfies ProductionHealth);
  return capable;
}

/** Why ordering is off, in /health's words; empty when it is on. */
export async function orderingBlockers(ctx: Ctx): Promise<string[]> {
  const reasons: string[] = [];
  if (ctx.config.concurrentLimit === null) reasons.push("concurrent_limit_unknown");
  if (await ctx.store.get(ORDER_KEYS.stopped)) reasons.push("stopped_after_group_check");
  if ((await ctx.store.get<FirstOrder>(ORDER_KEYS.first))?.state === "pending") reasons.push("first_order_unverified");
  if (!(await productionCapable(ctx))) reasons.push("production_lacks_partition_rule");
  return reasons;
}

export async function requireOrdering(ctx: Ctx): Promise<void> {
  if ((await orderingBlockers(ctx)).length > 0) throw new Refusal("provisioning.ordering_off");
}

/** Notes a successful order, and starts the read-back when it is the first. */
export async function noteOrder(ctx: Ctx, orderId: string | null, phoneNumber: string): Promise<void> {
  await invalidateOwned(ctx);
  if (await ctx.store.get<FirstOrder>(ORDER_KEYS.first)) return;
  await ctx.store.put(ORDER_KEYS.first, {
    state: "pending",
    order_id: orderId,
    phone_number: phoneNumber,
    at: ctx.now(),
  } satisfies FirstOrder);
  await verifyFirstOrder(ctx);
}

/**
 * Reads the first order's number back, account-wide on purpose: a filter by
 * the group would hide exactly the failure this looks for.
 */
export async function verifyFirstOrder(ctx: Ctx): Promise<FirstOrder["state"] | "failed" | "none"> {
  const first = await ctx.store.get<FirstOrder>(ORDER_KEYS.first);
  if (!first) return "none";
  if (first.state === "verified") return "verified";
  const telnyx = ctx.telnyx;
  const record = await ctx.store.get<PartitionRecord>(KEYS.record);
  if (!telnyx || !record) return "pending";

  const query = new URLSearchParams({ "filter[phone_number]": first.phone_number });
  const listing = await telnyx.send("GET", `/v2/phone_numbers?${query.toString()}`);
  const items = (listing.body as { data?: Record<string, unknown>[] } | undefined)?.data ?? [];
  const found = listing.status === 200 ? items.find((item) => item.phone_number === first.phone_number) : undefined;

  if (!found) {
    if (first.order_id) {
      const order = await telnyx.send("GET", `/v2/number_orders/${encodeURIComponent(first.order_id)}`);
      const status = (order.body as { data?: { status?: unknown } } | undefined)?.data?.status;
      // An order that failed bought nothing; the next one is the first again.
      if (order.status === 200 && status === "failure") await ctx.store.delete(ORDER_KEYS.first);
    }
    return "pending";
  }

  if (found.billing_group_id === record.billing_group_id) {
    await ctx.store.put(ORDER_KEYS.first, { ...first, state: "verified" } satisfies FirstOrder);
    return "verified";
  }

  await ctx.store.put(ORDER_KEYS.stopped, { at: ctx.now(), reason: "group_not_kept" });
  const released =
    typeof found.id === "string"
      ? (await telnyx.send("DELETE", `/v2/phone_numbers/${encodeURIComponent(found.id)}`)).status
      : 0;
  await sendProductionEvent(ctx, {
    key: "telnyx-guard-order-group",
    summary: "The rig's first number order did not keep its billing group; ordering is stopped",
    detail:
      `Telnyx number ${String(found.id ?? "(no id)")} came back with billing group ` +
      `${String(found.billing_group_id ?? "none")}, not the partition's. The guard released it ` +
      `(DELETE answered ${released}) and will order nothing again. Production's sweep would have ` +
      "treated a number with no group as its own. See the Fallbacks in docs/RIG.md.",
    level: "error",
  });
  return "failed";
}
