import type { Ctx } from "../context";
import {
  PARTITION_CAPABILITY,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_HEALTH_CACHE_MS,
} from "../limits";
import { Refusal } from "../refusal";
import { sendProductionEvent } from "../sentry";
import { SPEC } from "../setup/spec";
import { invalidateOwned, KEYS, type PartitionRecord, type StandingNumber } from "./partition";

/**
 * Number ordering (docs/RIG.md). Production's sweep lists the whole account
 * and can DELETE, and it acts only on numbers with no billing group once
 * Phase 0a ships. So nothing is ordered until production's /health says the
 * rule is live. The first order is then read back: once Telnyx reports the
 * order complete, the number is found in /v2/phone_numbers by its exact
 * E.164 and the partition's group, and its group, profile and connection are
 * checked. The order line's own id is never used: Telnyx does not say it is
 * the number's id. Anything the read-back cannot pin to one number stops
 * ordering without deleting anything.
 */
interface ProductionHealth {
  capable: boolean;
  checked_at: number;
}

/** What an order asked the number to be bound to. */
export interface OrderedBinding {
  messaging_profile_id: string;
  /** Null for a number ordered with no voice connection. */
  connection_id: string | null;
}

export interface FirstOrder {
  state: "pending" | "verified";
  order_id: string | null;
  phone_number: string;
  /** Absent on a record from before the field: the number's standing role then says what it should carry. */
  expect?: OrderedBinding;
  /** The /v2/phone_numbers id, once the read-back found the number. */
  number_id?: string;
  at: number;
}

/** Stop reasons a person may lift: the read-back could not list the number, and nothing is known to be wrong with it. */
export const RESUMABLE_STOPS: readonly string[] = ["number_unreadable"];

const RESUMES_KEEP = 20;

export interface OrderingResume {
  at: number;
  by: string;
  why: string;
  cleared: string;
}

export const ORDER_KEYS = {
  health: "production:health",
  first: "orders:first",
  stopped: "orders:stopped",
  last: "orders:last",
  resumes: "orders:resumes",
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

/** The reason code ordering was stopped for good, when it was: a code only, never an id or a number. */
export async function stoppedReason(ctx: Ctx): Promise<string | null> {
  return (await ctx.store.get<{ reason?: string }>(ORDER_KEYS.stopped))?.reason ?? null;
}

export async function requireOrdering(ctx: Ctx): Promise<void> {
  if ((await orderingBlockers(ctx)).length > 0) throw new Refusal("provisioning.ordering_off");
}

/** Notes a successful order, and starts the read-back when it is the first. */
export async function noteOrder(
  ctx: Ctx,
  orderId: string | null,
  phoneNumber: string,
  expect: OrderedBinding,
): Promise<void> {
  await invalidateOwned(ctx);
  if (await ctx.store.get<FirstOrder>(ORDER_KEYS.first)) return;
  await ctx.store.put(ORDER_KEYS.first, {
    state: "pending",
    order_id: orderId,
    phone_number: phoneNumber,
    expect,
    at: ctx.now(),
  } satisfies FirstOrder);
  await verifyFirstOrder(ctx);
}

/** A read Telnyx may answer properly later: asked again on the next upkeep. */
function retryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

async function read(ctx: Ctx, path: string): Promise<{ status: number; data: Item | null; items: Item[] | null }> {
  const reply = await ctx.telnyx!.send("GET", path).catch(() => ({ status: 0, body: undefined }));
  const data = (reply.body as { data?: unknown } | undefined)?.data;
  return {
    status: reply.status,
    data: data && typeof data === "object" && !Array.isArray(data) ? (data as Item) : null,
    items: Array.isArray(data) ? (data as Item[]) : null,
  };
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

/** What the number should carry: what its order asked for, else its standing role's binding. */
function expectedBinding(first: FirstOrder, record: PartitionRecord, standing: Record<string, StandingNumber>): OrderedBinding | null {
  if (first.expect) return first.expect;
  const role = Object.values(standing).find((entry) => entry.phone_number === first.phone_number)?.role;
  const profile = SPEC.numbers.standing.find((item) => item.role === role)?.messaging_profile;
  const id = profile ? record.messaging_profiles[profile] : undefined;
  // A standing order from before the field was placed while paid dials were refused: no connection.
  return id ? { messaging_profile_id: id, connection_id: null } : null;
}

/**
 * The first order's read-back. The order is read first and must be complete
 * and name exactly the E.164 that was ordered. The number is then listed by
 * that E.164 and the partition's group, and there must be exactly one, still
 * in the group, carrying the profile and connection the order asked for. Its
 * /v2/phone_numbers id is recorded. Nothing is ever released here: a number
 * that cannot be pinned down is left for a person.
 */
export async function verifyFirstOrder(ctx: Ctx): Promise<FirstOrder["state"] | "failed" | "none"> {
  const first = await ctx.store.get<FirstOrder>(ORDER_KEYS.first);
  if (!first) return "none";
  if (first.state === "verified") return "verified";
  if (await ctx.store.get(ORDER_KEYS.stopped)) return "failed";
  const record = await ctx.store.get<PartitionRecord>(KEYS.record);
  if (!ctx.telnyx || !record) return "pending";

  if (!first.order_id) {
    return stop(ctx, "order_id_missing", "Telnyx returned no order id, so the order cannot be read back. Nothing was released.");
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
  if (lines.length !== 1 || lines[0]?.phone_number !== first.phone_number) {
    return stop(ctx, "order_ambiguous", `The complete order lists ${lines.length} number(s), not exactly the one ordered. Nothing was released.`);
  }

  const query = new URLSearchParams({
    "filter[phone_number]": first.phone_number,
    "filter[billing_group_id]": record.billing_group_id,
  });
  const found = await read(ctx, `/v2/phone_numbers?${query.toString()}`);
  if (retryable(found.status)) return "pending";
  if (found.status !== 200 || !found.items) {
    return stop(ctx, "number_unreadable", `Listing the ordered number answered ${found.status}. Nothing was released.`);
  }
  if (found.items.length !== 1) {
    return stop(
      ctx,
      found.items.length === 0 ? "number_missing" : "number_ambiguous",
      `Listing the ordered number by its E.164 and the partition's group found ${found.items.length}, not one. Nothing was released.`,
    );
  }
  const [number] = found.items;
  const numberId = typeof number.id === "string" && number.id ? number.id : null;
  if (!numberId || number.phone_number !== first.phone_number) {
    return stop(ctx, "number_ambiguous", "The one listed number is not the one ordered. Nothing was released.");
  }
  if (number.billing_group_id !== record.billing_group_id) {
    return stop(
      ctx,
      "group_not_kept",
      `The ordered number is not in the partition's billing group (${String(number.billing_group_id ?? "none")}). ` +
        "Production's sweep treats a number with no group as its own. Nothing was released; regroup or release it by hand.",
    );
  }
  const standing = (await ctx.store.get<Record<string, StandingNumber>>(KEYS.standing)) ?? {};
  const expected = expectedBinding(first, record, standing);
  const connection = typeof number.connection_id === "string" && number.connection_id ? number.connection_id : null;
  const profile = typeof number.messaging_profile_id === "string" && number.messaging_profile_id ? number.messaging_profile_id : null;
  if (!expected || profile !== expected.messaging_profile_id || connection !== expected.connection_id) {
    return stop(ctx, "binding_mismatch", "The ordered number carries a messaging profile or voice connection other than the one ordered. Nothing was released.");
  }

  await ctx.store.put(ORDER_KEYS.first, { ...first, state: "verified", number_id: numberId } satisfies FirstOrder);
  return "verified";
}

/**
 * Lifts a stop in {@link RESUMABLE_STOPS} on an operator's say-so, records who
 * and why, and judges the pending first order again with the current
 * read-back. The number that was ordered is adopted by that read-back, not
 * ordered again. A read-back that fails stops ordering again.
 */
export async function resumeOrdering(
  ctx: Ctx,
  by: string,
  why: string,
): Promise<{ cleared: string; state: Awaited<ReturnType<typeof verifyFirstOrder>> }> {
  const reason = await stoppedReason(ctx);
  if (!reason || !RESUMABLE_STOPS.includes(reason)) throw new Refusal("provisioning.resume_refused");
  const past = (await ctx.store.get<OrderingResume[]>(ORDER_KEYS.resumes)) ?? [];
  await ctx.store.put(ORDER_KEYS.resumes, [...past, { at: ctx.now(), by, why, cleared: reason }].slice(-RESUMES_KEEP));
  await ctx.store.delete(ORDER_KEYS.stopped);
  return { cleared: reason, state: await verifyFirstOrder(ctx) };
}
