import type { Ctx } from "../context";
import type { DetachRequest } from "../edge-contract";
import { SPEC } from "../setup/spec";
import { monthOf } from "../state/counters";
import { readTier } from "../state/ledger";
import { invalidateOwned, type OwnedNumber, type PartitionView } from "./partition";

/**
 * Detach: clear a number's connection and messaging profile, so nothing
 * inbound reaches it and nothing inbound bills beyond the number's rental
 * (docs/RIG.md). The one write the guard makes to a standing number on its
 * own, for two reasons only: strangers flooding it, and the month's cap.
 *
 * Telnyx documents `""` as "unassign" for the messaging profile. Clearing the
 * connection the same way is not in its docs, so a non-200 is logged.
 */
export interface DetachRecord {
  at: number;
  reason: "stranger_flood" | "monthly_cap";
  /** The edge's count, for a flood. */
  strangers?: number;
  window_ms?: number;
}

const DETACHED_PREFIX = "detached:";
const CAP_DONE_PREFIX = "cap-detached:";

export async function detachNumber(
  ctx: Ctx,
  number: OwnedNumber,
  reason: DetachRecord["reason"],
  flood: Pick<DetachRecord, "strangers" | "window_ms"> = {},
): Promise<boolean> {
  const telnyx = ctx.telnyx;
  if (!telnyx) return false;
  const id = encodeURIComponent(number.id);
  const voice = await telnyx.send("PATCH", `/v2/phone_numbers/${id}`, { connection_id: "" });
  const messaging = await telnyx.send("PATCH", `/v2/phone_numbers/${id}/messaging`, { messaging_profile_id: "" });
  const ok = voice.status === 200 && messaging.status === 200;
  if (ok) await ctx.store.put(`${DETACHED_PREFIX}${number.id}`, { at: ctx.now(), reason, ...flood } satisfies DetachRecord);
  else console.error(`guard: detach of ${number.id} answered ${voice.status}/${messaging.status}`);
  await invalidateOwned(ctx);
  return ok;
}

export async function detachedNumbers(ctx: Ctx): Promise<Map<string, DetachRecord>> {
  const out = new Map<string, DetachRecord>();
  for (const [key, value] of await ctx.store.list<DetachRecord>(DETACHED_PREFIX)) {
    out.set(key.slice(DETACHED_PREFIX.length), value);
  }
  return out;
}

export async function clearDetached(ctx: Ctx, numberId: string): Promise<void> {
  await ctx.store.delete(`${DETACHED_PREFIX}${numberId}`);
}

/**
 * The edge counts strangers and decides a flood (it sees every event); the
 * guard checks only that the number is the partition's, and is idempotent.
 */
export async function detachFlooded(
  ctx: Ctx,
  view: PartitionView,
  request: DetachRequest,
): Promise<"detached" | "already_detached" | "not_owned" | "failed"> {
  const number = view.byE164.get(request.e164);
  if (!number) return "not_owned";
  if ((await detachedNumbers(ctx)).has(number.id)) return "already_detached";
  const ok = await detachNumber(ctx, number, "stranger_flood", {
    strangers: request.strangers,
    window_ms: request.window_ms,
  });
  return ok ? "detached" : "failed";
}

/**
 * At the month's cap every number off the robot's connection is detached, so
 * stranger inbound stops costing money too. Once per month.
 */
export async function enforceCap(ctx: Ctx, view: PartitionView): Promise<number> {
  const reading = await readTier(ctx);
  if (reading.month_to_date_usd < reading.usage_budget_usd) return 0;
  const doneKey = `${CAP_DONE_PREFIX}${monthOf(ctx.now())}`;
  if (await ctx.store.get(doneKey)) return 0;
  await ctx.store.put(doneKey, ctx.now());
  let detached = 0;
  const robot = view.record.connections.robot;
  for (const number of view.numbers) {
    if (robot && number.connection_id === robot) continue;
    if (await detachNumber(ctx, number, "monthly_cap")) detached += 1;
  }
  return detached;
}

/** The connection and profile each standing role is bound to, from the spec. */
export function standingBinding(
  view: PartitionView,
  role: string,
): { connection_id: string | null; messaging_profile_id: string | null } | null {
  const entry = SPEC.numbers.standing.find((item) => item.role === role);
  if (!entry) return null;
  return {
    connection_id: view.record.connections[entry.connection] ?? null,
    messaging_profile_id: view.record.messaging_profiles[entry.messaging_profile] ?? null,
  };
}
