import type { Ctx } from "./context";
import { json, Refusal } from "./refusal";
import { requireSafe, runSafetyChecks } from "./setup/safety";
import { runSetup } from "./setup/setup";
import { SPEC } from "./setup/spec";
import { TelnyxError } from "./telnyx/client";
import { clearDetached, detachedNumbers, standingBinding } from "./telnyx/detach";
import { isDefiniteFailure, isOk } from "./telnyx/forward";
import { noteOrder, requireOrdering, resumeOrdering, verifyFirstOrder } from "./telnyx/ordering";
import { invalidateOwned, KEYS, loadPartition, STANDING_TAG, standingReference } from './telnyx/partition';
import type { StandingNumber } from './telnyx/partition';
import { checkOrderBody } from "./telnyx/provisioning";

/**
 * The admin class (docs/RIG.md): the setup routine, the number
 * lifecycle for standing numbers. The admin token is scoped to the `guard` environment.
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

/** Numbers one search asks for, so a number held for another role can be passed over. */
const SEARCH_OFFERS = 5;

async function standingMap(ctx: Ctx): Promise<Record<string, StandingNumber>> {
  return (await ctx.store.get<Record<string, StandingNumber>>(KEYS.standing)) ?? {};
}

async function orderStanding(ctx: Ctx): Promise<Response> {
  await requireSafe(ctx);
  await verifyFirstOrder(ctx);
  await requireOrdering(ctx);
  const telnyx = ctx.telnyx!;
  const view = await loadPartition(ctx, { fresh: true });
  const standing = await standingMap(ctx);
  const detached = await detachedNumbers(ctx);

  let tagged = 0;
  let bound = 0;
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
  for (const entry of Object.values(standing)) {
    const number = view.byE164.get(entry.phone_number);
    const connection = standingBinding(view, entry.role)?.connection_id;
    if (number?.connection_id !== null || !connection || detached.has(number.id)) continue;
    await telnyx.call("PATCH", `/v2/phone_numbers/${encodeURIComponent(number.id)}`, { connection_id: connection });
    bound += 1;
  }
  if (tagged + bound > 0) await invalidateOwned(ctx);

  const unlisted = Object.values(standing)
    .filter((entry) => !view.byE164.has(entry.phone_number))
    .map((entry) => entry.role);
  const missing = SPEC.numbers.standing.filter((item) => !standing[item.role]);
  if (missing.length === 0) return json({ ordered: null, remaining: [], unlisted, tagged, bound });

  const [role] = missing;
  const binding = standingBinding(view, role.role);
  if (!binding?.connection_id || !binding.messaging_profile_id) throw new Refusal("startup.unconfigured");

  // One search per call, rotating through the spec's area codes: an area
  // code with no inventory moves the next call on to the next one.
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
  if (reply.status !== 200) throw new TelnyxError("GET", "/v2/available_phone_numbers", reply.status);
  if (!found) {
    await ctx.store.put("standing:area-index", index + 1);
    return json({ ordered: null, searched: areaCode, remaining: missing.map((item) => item.role), tagged, bound });
  }

  const checked = checkOrderBody(
    view,
    {
      phone_numbers: [{ phone_number: found }],
      billing_group_id: view.record.billing_group_id,
      connection_id: binding.connection_id,
      messaging_profile_id: binding.messaging_profile_id,
      customer_reference: standingReference(role.role),
    },
  );

  // The role is held before the order is sent, so neither a second caller
  // nor a retry after an answer that is not a refusal orders it again.
  const current = await standingMap(ctx);
  if (current[role.role] || Object.values(current).some((entry) => entry.phone_number === found)) {
    return json({ ordered: null, remaining: missing.map((item) => item.role), tagged, bound });
  }
  await ctx.store.put(KEYS.standing, { ...current, [role.role]: { role: role.role, phone_number: found } });
  const placed = await telnyx
    .send("POST", "/v2/number_orders", checked.body)
    .catch(() => ({ status: 0, body: undefined, text: "" }));
  if (isDefiniteFailure(placed)) {
    const kept = Object.entries(await standingMap(ctx)).filter(([held]) => held !== role.role);
    await ctx.store.put(KEYS.standing, Object.fromEntries(kept));
    throw new TelnyxError("POST", "/v2/number_orders", placed.status);
  }
  if (!isOk(placed)) {
    // Telnyx may have bought it: the role stays held, and a person checks the partition.
    return json({ error: "order_unconfirmed", role: role.role, status: placed.status }, 502);
  }
  const order = placed.body as { data?: { id?: unknown } } | undefined;
  await noteOrder(ctx, typeof order?.data?.id === "string" ? order.data.id : null, found, {
    messaging_profile_id: binding.messaging_profile_id,
    connection_id: binding.connection_id,
  });
  return json({
    ordered: role.role,
    remaining: missing.slice(1).map((item) => item.role),
    unlisted,
    tagged,
    bound,
  });
}

/** Restores the spec binding for each standing number. */
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
    case "POST /setup": {
      return json(await runSetup(ctx));
    }
    case "POST /check": {
      if (!ctx.telnyx) throw new Refusal("telnyx.key_missing");
      return json(await runSafetyChecks(ctx));
    }
    case "POST /numbers/order-standing": {
      return orderStanding(ctx);
    }
    case "POST /numbers/reattach": {
      return reattach(ctx);
    }
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
    default: {
      throw new Refusal("route.unknown");
    }
  }
}
