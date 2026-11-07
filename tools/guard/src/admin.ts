import type { Ctx } from "./context";
import { COST_USD, MAX_NUMBERS_HELD, MIN_RATIO_SAMPLE, SEARCH_INTERVAL_MS } from "./limits";
import { json, Refusal } from "./refusal";
import { runLimitProbe } from "./setup/limit-probe";
import { requireSafe, runSafetyChecks } from "./setup/safety";
import { runSetup } from "./setup/setup";
import { callerNameNumbers, SPEC } from "./setup/spec";
import {
  ADMISSION_KEYS,
  type AccountRateRecord,
  type RatiosRecord,
  type ReserveRecord,
  type WindowRecord,
} from "./state/admission";
import { LIMIT_KEYS, type HistoryRecord } from "./state/concurrency";
import { charge, noteHeld, reconcile } from "./state/ledger";
import { resumeMail } from "./state/mail";
import { TelnyxError } from "./telnyx/client";
import { clearDetached, detachedNumbers, standingBinding } from "./telnyx/detach";
import { isDefiniteFailure, isOk } from "./telnyx/forward";
import { noteOrder, requireOrdering, resumeOrdering, verifyFirstOrder } from "./telnyx/ordering";
import {
  heldCount,
  invalidateOwned,
  KEYS,
  loadPartition,
  STANDING_TAG,
  standingReference,
  type StandingNumber,
} from "./telnyx/partition";
import { checkOrderBody, requireSpendable, voiceOpen } from "./telnyx/provisioning";

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

/** Numbers one search asks for, so a number held for another role can be passed over. */
const SEARCH_OFFERS = 5;

async function standingMap(ctx: Ctx): Promise<Record<string, StandingNumber>> {
  return (await ctx.store.get<Record<string, StandingNumber>>(KEYS.standing)) ?? {};
}

/**
 * Orders the next standing role the partition does not hold yet, one per
 * call so the search interval holds without a request that waits; the caller
 * repeats until `remaining` is empty. Standing orders are exempt from the
 * 25-day order interval, which paces S28's monthly number, but not from the
 * ordering gate, the money gates or the ten-number cap. Every role is ordered
 * at once. While paid dials are refused no number gets a voice connection,
 * since a bound number takes inbound calls, and the answer lists them as
 * `voice_deferred`. Once paid dials open, each held standing number with no
 * connection is bound, unless it was detached.
 */
async function orderStanding(ctx: Ctx): Promise<Response> {
  await requireSafe(ctx);
  await verifyFirstOrder(ctx);
  await requireOrdering(ctx);
  await requireSpendable(ctx);
  const telnyx = ctx.telnyx!;
  const view = await loadPartition(ctx, { fresh: true });
  const standing = await standingMap(ctx);
  const paidOpen = await voiceOpen(ctx);
  const detached = await detachedNumbers(ctx);

  let tagged = 0;
  let bound = 0;
  const boundIds = new Set<string>();
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
  if (paidOpen) {
    for (const entry of Object.values(standing)) {
      const number = view.byE164.get(entry.phone_number);
      const connection = standingBinding(view, entry.role)?.connection_id;
      if (!number || number.connection_id !== null || !connection || detached.has(number.id)) continue;
      await telnyx.call("PATCH", `/v2/phone_numbers/${encodeURIComponent(number.id)}`, { connection_id: connection });
      boundIds.add(number.id);
      bound += 1;
    }
  }
  if (tagged + bound > 0) await invalidateOwned(ctx);

  const unbound = Object.values(standing)
    .filter((entry) => {
      const number = view.byE164.get(entry.phone_number);
      return number?.connection_id === null && !boundIds.has(number.id) && Boolean(standingBinding(view, entry.role)?.connection_id);
    })
    .map((entry) => entry.role);
  const unlisted = Object.values(standing)
    .filter((entry) => !view.byE164.has(entry.phone_number))
    .map((entry) => entry.role);
  const missing = SPEC.numbers.standing.filter((item) => !standing[item.role]);
  if (missing.length === 0) return json({ ordered: null, remaining: [], voice_deferred: unbound, unlisted, tagged, bound });
  if (heldCount(view) >= MAX_NUMBERS_HELD) throw new Refusal("provisioning.numbers_held");

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
    "filter[limit]": String(SEARCH_OFFERS),
  });
  const reply = await telnyx.send("GET", `/v2/available_phone_numbers?${query.toString()}`);
  // A role held after an unconfirmed order may name a number Telnyx still offers: it is never ordered for a second role.
  const taken = new Set([...view.byE164.keys(), ...Object.values(standing).map((entry) => entry.phone_number)]);
  const offered = (reply.body as { data?: { phone_number?: unknown }[] } | undefined)?.data ?? [];
  const found = offered.map((item) => item.phone_number).find((phone): phone is string => typeof phone === "string" && !taken.has(phone));
  if (reply.status !== 200 || !found) {
    await ctx.store.put("standing:area-index", index + 1);
    return json({ ordered: null, searched: areaCode, remaining: missing.map((item) => item.role), tagged, bound });
  }

  const checked = await checkOrderBody(
    { ctx, view },
    {
      phone_numbers: [{ phone_number: found }],
      billing_group_id: view.record.billing_group_id,
      ...(paidOpen ? { connection_id: binding.connection_id } : {}),
      messaging_profile_id: binding.messaging_profile_id,
      customer_reference: standingReference(role.role),
    },
    { voice: paidOpen },
  );

  // The role is held before the order is sent, so neither a second caller
  // nor a retry after an answer that is not a refusal orders it again.
  const current = await standingMap(ctx);
  if (current[role.role] || Object.values(current).some((entry) => entry.phone_number === found)) {
    return json({ ordered: null, remaining: missing.map((item) => item.role), tagged, bound });
  }
  if (heldCount(view, Object.values(current)) >= MAX_NUMBERS_HELD) throw new Refusal("provisioning.numbers_held");
  await ctx.store.put(KEYS.standing, { ...current, [role.role]: { role: role.role, phone_number: found } });
  const placed = await telnyx
    .send("POST", "/v2/number_orders", checked.body)
    .catch(() => ({ status: 0, body: undefined, text: "" }));
  if (isDefiniteFailure(placed)) {
    const kept = Object.entries(await standingMap(ctx)).filter(([held]) => held !== role.role);
    await ctx.store.put(KEYS.standing, Object.fromEntries(kept));
    throw new TelnyxError("POST", "/v2/number_orders", placed.status);
  }
  await charge(ctx, COST_USD.numberUpfront, "one_time");
  await noteHeld(ctx, heldCount(view, Object.values(current)) + 1, callerNameNumbers());
  if (!isOk(placed)) {
    // Telnyx may have bought it: the role stays held, and a person checks the partition.
    return json({ error: "order_unconfirmed", role: role.role, status: placed.status }, 502);
  }
  const order = placed.body as { data?: { id?: unknown } } | undefined;
  await noteOrder(ctx, typeof order?.data?.id === "string" ? order.data.id : null, found, {
    messaging_profile_id: binding.messaging_profile_id,
    connection_id: paidOpen ? binding.connection_id : null,
  });
  return json({
    ordered: role.role,
    remaining: missing.slice(1).map((item) => item.role),
    voice_deferred: paidOpen ? unbound : [...unbound, role.role],
    unlisted,
    tagged,
    bound,
  });
}

/**
 * Restores every standing number's spec binding: the undo for a detach. The
 * voice connection comes back only while paid dials are open; until then a
 * number gets its messaging profile alone, and order-standing binds it later.
 */
async function reattach(ctx: Ctx): Promise<Response> {
  await requireSafe(ctx);
  const telnyx = ctx.telnyx!;
  const view = await loadPartition(ctx, { fresh: true });
  const paidOpen = await voiceOpen(ctx);
  const done: string[] = [];
  for (const entry of Object.values(await standingMap(ctx))) {
    const number = view.byE164.get(entry.phone_number);
    const binding = standingBinding(view, entry.role);
    if (!number || !binding?.connection_id || !binding.messaging_profile_id) continue;
    if (paidOpen) {
      await telnyx.call("PATCH", `/v2/phone_numbers/${encodeURIComponent(number.id)}`, {
        connection_id: binding.connection_id,
      });
    }
    await telnyx.call("PATCH", `/v2/phone_numbers/${encodeURIComponent(number.id)}/messaging`, {
      messaging_profile_id: binding.messaging_profile_id,
    });
    await clearDetached(ctx, number.id);
    done.push(entry.role);
  }
  await invalidateOwned(ctx);
  return json(paidOpen ? { reattached: done } : { reattached: done, voice_deferred: done });
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
    case "POST /numbers/resume-ordering": {
      const by = typeof body.by === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(body.by) ? body.by : null;
      // The reason lands in a public log, so it carries no run of digits long enough to be a number or an id.
      const why =
        typeof body.reason === "string" && body.reason.trim().length >= 8 && body.reason.trim().length <= 200 && !/\d{7,}|\+\d/.test(body.reason)
          ? body.reason.trim()
          : null;
      if (!by || !why) throw new Refusal("request.body_invalid");
      await requireSafe(ctx);
      return json(await resumeOrdering(ctx, by, why));
    }
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
        low_sample: calls < MIN_RATIO_SAMPLE,
        measured_at: measuredAt(ctx, body.measured_at),
      };
      await ctx.store.put(ADMISSION_KEYS.ratios, record);
      return json(record);
    }
    case "POST /concurrency-history": {
      const record: HistoryRecord = { peak_calls: count(body.peak_calls, 10_000), measured_at: measuredAt(ctx, body.measured_at) };
      await ctx.store.put(LIMIT_KEYS.history, record);
      return json(record);
    }
    case "POST /account-rate": {
      const record: AccountRateRecord = {
        peak_hour_dials: count(body.peak_hour_dials, 100_000),
        peak_day_dials: count(body.peak_day_dials, 1_000_000),
        measured_at: measuredAt(ctx, body.measured_at),
      };
      if (record.peak_hour_dials > record.peak_day_dials) throw new Refusal("request.body_invalid");
      await ctx.store.put(ADMISSION_KEYS.accountRate, record);
      return json(record);
    }
    case "POST /limit-probe":
      return json(await runLimitProbe(ctx));
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
    case "POST /mail/resume":
      await resumeMail(ctx);
      return json({ resumed: true });
    default:
      throw new Refusal("route.unknown");
  }
}
