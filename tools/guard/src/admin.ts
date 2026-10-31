import type { Ctx } from "./context";
import { acceptInventory, runKeyInventory } from "./inventory";
import { COST_USD, MAX_NUMBERS_HELD, SEARCH_INTERVAL_MS } from "./limits";
import { json, Refusal } from "./refusal";
import { requireSafe, runSafetyChecks } from "./setup/safety";
import { runSetup } from "./setup/setup";
import { callerNameNumbers, SPEC } from "./setup/spec";
import { ADMISSION_KEYS, type RatiosRecord, type ReserveRecord, type WindowRecord } from "./state/admission";
import { charge, noteHeld, reconcile } from "./state/ledger";
import { resumeMail } from "./state/mail";
import { clearDetached, standingBinding } from "./telnyx/detach";
import { noteOrder, requireOrdering, verifyFirstOrder } from "./telnyx/ordering";
import {
  invalidateOwned,
  KEYS,
  loadPartition,
  STANDING_TAG,
  standingReference,
  type StandingNumber,
} from "./telnyx/partition";
import { checkOrderBody, requireSpendable } from "./telnyx/provisioning";

/**
 * The admin class (docs/RIG.md): the setup routine, the number
 * lifecycle for standing numbers, and the production measurements admission
 * needs. The admin token lives only in the `guard` GitHub environment.
 */
type Body = Record<string, unknown>;

async function readBody(request: Request): Promise<Body> {
  if (request.method === "GET") return {};
  const text = await request.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Body;
  } catch {
    // Falls through to the refusal below.
  }
  throw new Refusal("request.body_invalid");
}

function count(value: unknown, max = 1_000_000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw new Refusal("request.body_invalid");
  }
  return value;
}

/** A measurement's time: when it was taken, never later than now. */
function measuredAt(ctx: Ctx, value: unknown): number {
  if (value === undefined) return ctx.now();
  const at = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(at)) throw new Refusal("request.body_invalid");
  return Math.min(at, ctx.now());
}

async function standingMap(ctx: Ctx): Promise<Record<string, StandingNumber>> {
  return (await ctx.store.get<Record<string, StandingNumber>>(KEYS.standing)) ?? {};
}

/**
 * Orders the next standing role the partition does not hold yet, one per
 * call so the search interval holds without a request that waits; the caller
 * repeats until `remaining` is empty. Standing orders are exempt from the
 * 25-day order interval, which paces S28's monthly number, but not from the
 * ordering gate, the money gates or the ten-number cap.
 */
async function orderStanding(ctx: Ctx): Promise<Response> {
  await requireSafe(ctx);
  await verifyFirstOrder(ctx);
  await requireOrdering(ctx);
  await requireSpendable(ctx);
  const telnyx = ctx.telnyx!;
  const view = await loadPartition(ctx, { fresh: true });
  const standing = await standingMap(ctx);

  let tagged = 0;
  for (const entry of Object.values(standing)) {
    const number = view.byE164.get(entry.phone_number);
    if (!number || number.tags.includes(STANDING_TAG)) continue;
    await telnyx.call("PATCH", `/v2/phone_numbers/${encodeURIComponent(number.id)}`, {
      tags: [...number.tags, STANDING_TAG],
    });
    const spec = SPEC.numbers.standing.find((item) => item.role === entry.role);
    if (spec?.caller_name_lookup) {
      await telnyx.call("PATCH", `/v2/phone_numbers/${encodeURIComponent(number.id)}/voice`, {
        caller_id_name_enabled: true,
      });
    }
    tagged += 1;
  }
  if (tagged > 0) await invalidateOwned(ctx);

  const missing = SPEC.numbers.standing.filter((item) => !standing[item.role]);
  if (missing.length === 0) return json({ ordered: null, remaining: [], tagged });
  if (view.numbers.length >= MAX_NUMBERS_HELD) throw new Refusal("provisioning.numbers_held");

  const role = missing[0];
  const binding = standingBinding(view, role.role);
  if (!binding?.connection_id || !binding.messaging_profile_id) throw new Refusal("startup.unconfigured");

  // One search per call, rotating through the spec's area codes: an area
  // code with no inventory moves the next call on to the next one.
  const last = (await ctx.store.get<number>("search:last")) ?? 0;
  if (ctx.now() - last < SEARCH_INTERVAL_MS) throw new Refusal("provisioning.search_rate");
  await ctx.store.put("search:last", ctx.now());
  const index = (await ctx.store.get<number>("standing:area-index")) ?? 0;
  const areaCode = SPEC.numbers.area_codes[index % SPEC.numbers.area_codes.length];
  const query = new URLSearchParams({
    "filter[country_code]": SPEC.numbers.country,
    "filter[national_destination_code]": areaCode,
    "filter[phone_number_type]": "local",
    "filter[limit]": "1",
  });
  const reply = await telnyx.send("GET", `/v2/available_phone_numbers?${query.toString()}`);
  const found = (reply.body as { data?: { phone_number?: unknown }[] } | undefined)?.data?.[0]?.phone_number;
  if (reply.status !== 200 || typeof found !== "string") {
    await ctx.store.put("standing:area-index", index + 1);
    return json({ ordered: null, searched: areaCode, remaining: missing.map((item) => item.role), tagged });
  }

  const checked = await checkOrderBody(
    { ctx, view },
    {
      phone_numbers: [{ phone_number: found }],
      billing_group_id: view.record.billing_group_id,
      connection_id: binding.connection_id,
      messaging_profile_id: binding.messaging_profile_id,
      customer_reference: standingReference(role.role),
    },
  );
  const order = await telnyx.call<{ data?: { id?: unknown } }>("POST", "/v2/number_orders", checked.body);
  await charge(ctx, COST_USD.numberUpfront, "one_time");
  await noteHeld(ctx, view.numbers.length + 1, callerNameNumbers());
  await ctx.store.put(KEYS.standing, { ...standing, [role.role]: { role: role.role, phone_number: found } });
  await noteOrder(ctx, typeof order?.data?.id === "string" ? order.data.id : null, found);
  return json({
    ordered: role.role,
    remaining: missing.slice(1).map((item) => item.role),
    tagged,
  });
}

/** Restores every standing number's spec binding: the undo for a detach. */
async function reattach(ctx: Ctx): Promise<Response> {
  await requireSafe(ctx);
  const telnyx = ctx.telnyx!;
  const view = await loadPartition(ctx, { fresh: true });
  const done: string[] = [];
  for (const entry of Object.values(await standingMap(ctx))) {
    const number = view.byE164.get(entry.phone_number);
    const binding = standingBinding(view, entry.role);
    if (!number || !binding?.connection_id || !binding.messaging_profile_id) continue;
    await telnyx.call("PATCH", `/v2/phone_numbers/${encodeURIComponent(number.id)}`, {
      connection_id: binding.connection_id,
    });
    await telnyx.call("PATCH", `/v2/phone_numbers/${encodeURIComponent(number.id)}/messaging`, {
      messaging_profile_id: binding.messaging_profile_id,
    });
    await clearDetached(ctx, number.id);
    done.push(entry.role);
  }
  await invalidateOwned(ctx);
  return json({ reattached: done });
}

export async function handleAdmin(ctx: Ctx, request: Request, path: string): Promise<Response> {
  const body = await readBody(request);
  const route = `${request.method.toUpperCase()} ${path}`;
  switch (route) {
    case "POST /setup":
      return json(await runSetup(ctx));
    case "POST /check":
      if (!ctx.telnyx) throw new Refusal("telnyx.key_missing");
      return json(await runSafetyChecks(ctx));
    case "POST /numbers/order-standing":
      return orderStanding(ctx);
    case "POST /numbers/reattach":
      return reattach(ctx);
    case "POST /reserve": {
      const record: ReserveRecord = { legs: count(body.legs, 1_000), measured_at: measuredAt(ctx, body.measured_at) };
      await ctx.store.put(ADMISSION_KEYS.reserve, record);
      return json(record);
    }
    case "POST /ratios": {
      const calls = count(body.calls);
      const record: RatiosRecord = {
        calls,
        abandoned: count(body.abandoned, calls),
        short: count(body.short, calls),
        measured_at: measuredAt(ctx, body.measured_at),
      };
      await ctx.store.put(ADMISSION_KEYS.ratios, record);
      return json(record);
    }
    case "POST /window": {
      const record: WindowRecord = { start_hour: count(body.start_hour, 23), measured_at: measuredAt(ctx, body.measured_at) };
      await ctx.store.put(ADMISSION_KEYS.window, record);
      return json(record);
    }
    case "POST /ledger": {
      const month = typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month) ? body.month : null;
      const usage = typeof body.usage_usd === "number" && body.usage_usd >= 0 ? body.usage_usd : null;
      if (!month || usage === null) throw new Refusal("request.body_invalid");
      return json(await reconcile(ctx, month, usage));
    }
    case "POST /key-inventory/run":
      return json(await runKeyInventory(ctx));
    case "POST /key-inventory/accept": {
      const baseline = await acceptInventory(ctx);
      if (!baseline) throw new Refusal("request.body_invalid");
      return json(baseline);
    }
    case "POST /mail/resume":
      await resumeMail(ctx);
      return json({ resumed: true });
    default:
      throw new Refusal("route.unknown");
  }
}
