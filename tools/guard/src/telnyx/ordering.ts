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
 * Number ordering (docs/RIG.md). Production's sweep lists the whole account
 * and can DELETE, and it acts only on numbers with no billing group once
 * Phase 0a ships. So nothing is ordered until production's /health says the
 * rule is live. The first order is then read back: once Telnyx reports the
 * order a success, the number the order names is read by its id, and if
 * Telnyx did not keep the group, that number alone is released and ordering
 * stops for good. Anything the read-back cannot pin to one number stops
 * ordering without deleting anything.
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

type Item = Record<string, unknown>;

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

/** A read Telnyx may answer properly later: asked again on the next upkeep. */
function retryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

async function read(ctx: Ctx, path: string): Promise<{ status: number; data: Item | null }> {
  const reply = await ctx.telnyx!.send("GET", path).catch(() => ({ status: 0, body: undefined }));
  const data = (reply.body as { data?: unknown } | undefined)?.data;
  return { status: reply.status, data: data && typeof data === "object" && !Array.isArray(data) ? (data as Item) : null };
}

/** Stops ordering for good, and says why in production's Sentry. Deletes nothing. */
async function stop(ctx: Ctx, reason: string, detail: string): Promise<"failed"> {
  await ctx.store.put(ORDER_KEYS.stopped, { at: ctx.now(), reason });
  await sendProductionEvent(ctx, {
    key: "telnyx-guard-order-group",
    summary: "The rig's first number order could not be confirmed in its billing group; ordering is stopped",
    detail: `${detail} See the Fallbacks in docs/RIG.md.`,
    level: "error",
  });
  return "failed";
}

/**
 * The first order's read-back. The order is read first, and judged only once
 * Telnyx reports it a success; the number is then read by the id the order
 * returned, never matched by its phone number. Account-wide on purpose: a
 * filter by the group would hide exactly the failure this looks for.
 */
export async function verifyFirstOrder(ctx: Ctx): Promise<FirstOrder["state"] | "failed" | "none"> {
  const first = await ctx.store.get<FirstOrder>(ORDER_KEYS.first);
  if (!first) return "none";
  if (first.state === "verified") return "verified";
  if (await ctx.store.get(ORDER_KEYS.stopped)) return "failed";
  const record = await ctx.store.get<PartitionRecord>(KEYS.record);
  if (!ctx.telnyx || !record) return "pending";

  if (!first.order_id) {
    return stop(ctx, "order_id_missing", "Telnyx returned no order id, so the number cannot be read back by id. Nothing was released.");
  }
  const order = await read(ctx, `/v2/number_orders/${encodeURIComponent(first.order_id)}`);
  if (retryable(order.status)) return "pending";
  if (order.status !== 200 || !order.data) {
    return stop(ctx, "order_unreadable", `The order read answered ${order.status}. Nothing was released.`);
  }
  if (order.data.status === "pending") return "pending";
  if (order.data.status === "failure") {
    // An order that failed bought nothing; the next one is the first again.
    await ctx.store.delete(ORDER_KEYS.first);
    return "pending";
  }
  if (order.data.status !== "success") {
    return stop(ctx, "order_status_unknown", "The order reported a status the guard does not know. Nothing was released.");
  }

  const lines = Array.isArray(order.data.phone_numbers) ? (order.data.phone_numbers as Item[]) : [];
  const line = lines.length === 1 ? lines[0] : undefined;
  const numberId = typeof line?.id === "string" && line.id ? line.id : null;
  if (!numberId || line?.phone_number !== first.phone_number) {
    return stop(ctx, "order_ambiguous", `The order lists ${lines.length} number(s), not the one ordered with an id. Nothing was released.`);
  }

  const number = await read(ctx, `/v2/phone_numbers/${encodeURIComponent(numberId)}`);
  if (retryable(number.status)) return "pending";
  if (number.status !== 200 || !number.data || number.data.id !== numberId || number.data.phone_number !== first.phone_number) {
    return stop(ctx, "number_unreadable", `Reading the ordered number by its id answered ${number.status}. Nothing was released.`);
  }
  if (number.data.billing_group_id === record.billing_group_id) {
    await ctx.store.put(ORDER_KEYS.first, { ...first, state: "verified" } satisfies FirstOrder);
    return "verified";
  }
  return releaseUngrouped(ctx, record, numberId, number.data.billing_group_id);
}

/**
 * The order's own number came back outside the group: read it by id once
 * more, and release it only if it is still bound to nothing of production's.
 */
async function releaseUngrouped(ctx: Ctx, record: PartitionRecord, numberId: string, group: unknown): Promise<"failed"> {
  const again = await read(ctx, `/v2/phone_numbers/${encodeURIComponent(numberId)}`);
  const onProduction =
    !again.data ||
    again.data.id !== numberId ||
    record.production.connection_ids.includes(String(again.data.connection_id ?? "")) ||
    record.production.messaging_profile_ids.includes(String(again.data.messaging_profile_id ?? ""));
  if (again.status !== 200 || onProduction) {
    return stop(
      ctx,
      "group_not_kept",
      `The ordered number came back with billing group ${String(group ?? "none")}, and its second read ` +
        `(${again.status}) could not show it is clear of production's connections and profiles, so it was not released.`,
    );
  }
  await ctx.store.put(ORDER_KEYS.stopped, { at: ctx.now(), reason: "group_not_kept" });
  const released = (await ctx.telnyx!.send("DELETE", `/v2/phone_numbers/${encodeURIComponent(numberId)}`).catch(() => ({ status: 0 }))).status;
  return stop(
    ctx,
    "group_not_kept",
    `The ordered number came back with billing group ${String(group ?? "none")}, not the partition's. ` +
      `The guard released it by its id (DELETE answered ${released}) and will order nothing again. ` +
      "Production's sweep would have treated a number with no group as its own.",
  );
}
