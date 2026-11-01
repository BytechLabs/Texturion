import { describe, expect, it } from "vitest";

import { CRONS } from "../src/guard";
import { ORDER_KEYS, orderingBlockers, stoppedReason, verifyFirstOrder, type FirstOrder, type OrderingResume } from "../src/telnyx/ordering";
import { lease, PROD_WEBHOOK, ready, type Harness } from "./support";

const ORDERED = "+14165550150";
const OTHER = "+14165550151";

async function order(h: Harness): Promise<number> {
  await lease(h, "S28", "rig-api");
  const response = await h.call("/telnyx/v2/number_orders", {
    body: {
      phone_numbers: [{ phone_number: ORDERED }],
      billing_group_id: "bg-nonprod",
      messaging_profile_id: "prof-qa-c",
      customer_reference: "company-qa-c",
    },
  });
  return response.status;
}

/** An order that is still pending, so the test controls when Telnyx reports it done. */
async function orderPending(h: Harness): Promise<void> {
  h.telnyx.orderStatus = "pending";
  expect(await order(h)).toBe(200);
}

/** The order the test placed, done. S28's order carries no connection while paid dials are refused, and the test's carries none. */
function complete(h: Harness): void {
  h.telnyx.numberOrders[0]!.status = "success";
}

const ordered = (h: Harness) => h.telnyx.numbers.find((item) => item.phone_number === ORDERED)!;
const deletes = (h: Harness) => h.telnyx.requests("DELETE").map((entry) => entry.path);
const numberLookups = (h: Harness) => h.telnyx.requests("GET", "/v2/phone_numbers").filter((entry) => entry.query.has("filter[phone_number]"));
const stopAlerts = (h: Harness) => h.outbound.filter((item) => item.body.includes('"fingerprint":["ops","telnyx-guard-order-group"]'));
const first = (h: Harness) => h.store.get<FirstOrder>(ORDER_KEYS.first);

/** Stopped, nothing deleted, one alert, and the reason code health shows. */
async function expectStopped(h: Harness, reason: string): Promise<void> {
  expect(await h.store.get(ORDER_KEYS.stopped)).toMatchObject({ reason });
  expect(await stoppedReason(h.ctx)).toBe(reason);
  expect(await orderingBlockers(h.ctx)).toContain("stopped_after_group_check");
  expect(deletes(h)).toEqual([]);
  expect(stopAlerts(h)).toHaveLength(1);
}

describe("the first order's read-back", () => {
  it("waits while the order is pending, and looks for the number only once Telnyx reports it complete", async () => {
    const h = await ready();
    await orderPending(h);
    expect(await first(h)).toMatchObject({ state: "pending" });
    expect(await orderingBlockers(h.ctx)).toEqual(["first_order_unverified"]);
    expect(numberLookups(h)).toEqual([]);

    complete(h);
    await h.guard.cron(CRONS.upkeep);
    expect(await first(h)).toMatchObject({ state: "verified" });
    expect(await orderingBlockers(h.ctx)).toEqual([]);
    expect(numberLookups(h)).toHaveLength(1);
  });

  it("finds the number by its exact E.164 and the partition's group, and records the id the listing gives", async () => {
    const h = await ready();
    expect(await order(h)).toBe(200);
    const [lookup] = numberLookups(h);
    expect(lookup!.query.get("filter[phone_number]")).toBe(ORDERED);
    expect(lookup!.query.get("filter[billing_group_id]")).toBe("bg-nonprod");

    const lineId = (h.telnyx.numberOrders[0]!.phone_numbers as { id: string }[])[0]!.id;
    expect(lineId).not.toBe(ordered(h).id);
    const record = await first(h);
    expect(record).toMatchObject({ state: "verified", number_id: ordered(h).id });
    expect(record?.number_id).not.toBe(lineId);
    expect(h.telnyx.requests("GET", `/v2/phone_numbers/${lineId}`)).toEqual([]);
    expect(deletes(h)).toEqual([]);
  });

  it("verifies the same way when the order line's id happens to be the number's", async () => {
    const h = await ready();
    h.telnyx.orderLineIds = false;
    expect(await order(h)).toBe(200);
    expect(await first(h)).toMatchObject({ state: "verified", number_id: ordered(h).id });
  });

  it("stops without deleting when the number is not in the partition's group", async () => {
    const h = await ready();
    h.telnyx.dropGroupOnOrder = true;
    expect(await order(h)).toBe(200);
    expect(await first(h)).toMatchObject({ state: "pending" });
    expect(ordered(h)).toBeDefined();
    await expectStopped(h, "number_missing");
  });

  it("stops without deleting when more than one number matches", async () => {
    const h = await ready();
    await orderPending(h);
    h.telnyx.numbers.push({ ...ordered(h), id: "num-twin" });
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "number_ambiguous");
  });

  it("stops without deleting when the listing ignores its filters and hands back the account", async () => {
    const h = await ready();
    await orderPending(h);
    h.telnyx.ignoreFilters = true;
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "number_ambiguous");
  });

  it("stops without deleting when the one number listed is in another group", async () => {
    const h = await ready();
    await orderPending(h);
    h.telnyx.ignoreFilters = true;
    h.telnyx.numbers = [Object.assign(ordered(h), { billing_group_id: "bg-production" })];
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "group_not_kept");
  });

  it("stops without deleting when the one number listed is not the one ordered", async () => {
    const h = await ready();
    await orderPending(h);
    h.telnyx.ignoreFilters = true;
    h.telnyx.numbers = [Object.assign(ordered(h), { phone_number: OTHER })];
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "number_ambiguous");
  });

  it("stops without deleting when the number carries another messaging profile", async () => {
    const h = await ready();
    await orderPending(h);
    ordered(h).messaging_profile_id = "prof-robot";
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "binding_mismatch");
  });

  it("stops without deleting when the number carries a different voice connection than it was ordered with", async () => {
    const h = await ready();
    await orderPending(h);
    expect(ordered(h).connection_id).toBe("conn-voice");
    ordered(h).connection_id = "conn-robot";
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "binding_mismatch");
  });

  it("stops without deleting when the number has lost the voice connection it was ordered with", async () => {
    const h = await ready();
    await orderPending(h);
    ordered(h).connection_id = null;
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "binding_mismatch");
  });

  it("stops without deleting when a number ordered with no connection carries one", async () => {
    const h = await ready();
    await orderPending(h);
    await h.store.put(ORDER_KEYS.first, { ...(await first(h))!, expect: { messaging_profile_id: "prof-qa-c", connection_id: null } });
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "binding_mismatch");
  });

  it("stops without deleting when the number is on production's connection", async () => {
    const h = await ready();
    await orderPending(h);
    Object.assign(ordered(h), { connection_id: "conn-prod-voice", messaging_profile_id: "prof-prod" });
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "binding_mismatch");
  });

  it("stops without deleting when the complete order names a different number", async () => {
    const h = await ready();
    await orderPending(h);
    (h.telnyx.numberOrders[0]!.phone_numbers as Record<string, unknown>[])[0]!.phone_number = OTHER;
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    expect(numberLookups(h)).toEqual([]);
    await expectStopped(h, "order_ambiguous");
  });

  it("stops without deleting when the complete order lists more than one number", async () => {
    const h = await ready();
    await orderPending(h);
    (h.telnyx.numberOrders[0]!.phone_numbers as Record<string, unknown>[]).push({ id: "line-2", phone_number: OTHER });
    complete(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "order_ambiguous");
  });

  it("stops without deleting when the order reports a status it does not know", async () => {
    const h = await ready();
    await orderPending(h);
    h.telnyx.numberOrders[0]!.status = "partially-fulfilled";
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    expect(numberLookups(h)).toEqual([]);
    await expectStopped(h, "order_status_unknown");
  });

  it("stops without deleting when the listing answers with an error that cannot pass", async () => {
    const h = await ready();
    await orderPending(h);
    complete(h);
    h.telnyx.failNext = { method: "GET", path: "/v2/phone_numbers", status: 403, whenQuery: "filter%5Bphone_number%5D" };
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "number_unreadable");
  });

  it("asks again after a listing that may pass", async () => {
    const h = await ready();
    await orderPending(h);
    complete(h);
    h.telnyx.failNext = { method: "GET", path: "/v2/phone_numbers", status: 503, whenQuery: "filter%5Bphone_number%5D" };
    expect(await verifyFirstOrder(h.ctx)).toBe("pending");
    expect(await h.store.get(ORDER_KEYS.stopped)).toBeUndefined();
    expect(await verifyFirstOrder(h.ctx)).toBe("verified");
  });

  it("stops without deleting when there is no order id to read", async () => {
    const h = await ready();
    h.telnyx.numbers.push({ id: "num-loose", phone_number: ORDERED, billing_group_id: null, connection_id: null, tags: [] });
    await h.store.put(ORDER_KEYS.first, { state: "pending", order_id: null, phone_number: ORDERED, at: h.clock.now } satisfies FirstOrder);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "order_id_missing");
  });

  it("asks again after an order read that may pass, and forgets an order that failed", async () => {
    const h = await ready();
    await orderPending(h);
    const orderId = h.telnyx.numberOrders[0]!.id as string;
    h.telnyx.failNext = { method: "GET", path: `/v2/number_orders/${orderId}`, status: 503 };
    expect(await verifyFirstOrder(h.ctx)).toBe("pending");
    expect(await h.store.get(ORDER_KEYS.stopped)).toBeUndefined();
    h.telnyx.numberOrders[0]!.status = "failure";
    await verifyFirstOrder(h.ctx);
    expect(await first(h)).toBeUndefined();
    expect(deletes(h)).toEqual([]);
  });

  it("stops without deleting on an order read that cannot pass", async () => {
    const h = await ready();
    await orderPending(h);
    const orderId = h.telnyx.numberOrders[0]!.id as string;
    h.telnyx.failNext = { method: "GET", path: `/v2/number_orders/${orderId}`, status: 404 };
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "order_unreadable");
  });
});

describe("a first order recorded before the read-back kept what it asked for", () => {
  /** ROBOT-1 as the first standing order left it: held with its profile and no connection, the record without `expect`. */
  async function legacy(h: Harness, patch: Record<string, unknown> = {}): Promise<void> {
    h.telnyx.orderStatus = "success";
    h.telnyx.numberOrders.push({
      id: "order-legacy",
      status: "success",
      phone_numbers: [{ id: "order-line-legacy", phone_number: ORDERED }],
    });
    h.telnyx.numbers.push({
      id: "num-legacy",
      phone_number: ORDERED,
      billing_group_id: "bg-nonprod",
      connection_id: null,
      messaging_profile_id: "prof-robot",
      customer_reference: "rig-standing-robot-1",
      tags: [],
      ...patch,
    });
    await h.store.put("partition:standing", { "ROBOT-1": { role: "ROBOT-1", phone_number: ORDERED } });
    await h.store.put(ORDER_KEYS.first, { state: "pending", order_id: "order-legacy", phone_number: ORDERED, at: h.clock.now } satisfies FirstOrder);
  }

  it("is judged against its standing role's profile and no connection", async () => {
    const h = await ready();
    await legacy(h);
    expect(await verifyFirstOrder(h.ctx)).toBe("verified");
    expect(await first(h)).toMatchObject({ number_id: "num-legacy" });
  });

  it("stops when the number carries another role's profile", async () => {
    const h = await ready();
    await legacy(h, { messaging_profile_id: "prof-qa-w" });
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "binding_mismatch");
  });

  it("stops when it names no standing role, since nothing says what it should carry", async () => {
    const h = await ready();
    await legacy(h);
    await h.store.delete("partition:standing");
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    await expectStopped(h, "binding_mismatch");
  });
});

describe("resuming ordering after number_unreadable", () => {
  const resume = (h: Harness, body: unknown = { by: "operator-1", reason: "Read-back now lists the number" }) =>
    h.call("/admin/numbers/resume-ordering", { caller: "admin", method: "POST", body });

  /** The incident: ROBOT-1 ordered, then the old read-back's 404 stopped ordering as number_unreadable. */
  async function stoppedAfterRobot1(): Promise<Harness> {
    const h = await ready({ validated: null });
    h.telnyx.numbers = h.telnyx.numbers.filter((item) => item.id === "num-prod");
    h.telnyx.available = ["+14165550170", "+14165550171", "+14165550172", "+14165550173", "+14165550174", "+14165550175", "+14165550176", "+14165550177"];
    h.telnyx.failNext = { method: "GET", path: "/v2/phone_numbers", status: 403, whenQuery: "filter%5Bphone_number%5D" };
    const answer = await h.call("/admin/numbers/order-standing", { caller: "admin", method: "POST" });
    expect(answer.status).toBe(200);
    expect(await stoppedReason(h.ctx)).toBe("number_unreadable");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toHaveLength(1);
    return h;
  }

  it("adopts the number already ordered, orders the other seven, and never orders it again", async () => {
    const h = await stoppedAfterRobot1();
    h.advance(11_000);
    expect(await ruleOfOrderStanding(h)).toBe("provisioning.ordering_off");

    const response = await resume(h);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cleared: "number_unreadable", state: "verified" });
    const adopted = h.telnyx.numbers.find((item) => item.phone_number === "+14165550170")!;
    expect(await first(h)).toMatchObject({ state: "verified", number_id: adopted.id });
    expect(await h.store.get(ORDER_KEYS.stopped)).toBeUndefined();
    expect(await orderingBlockers(h.ctx)).toEqual([]);

    for (let call = 0; call < 7; call++) {
      h.advance(11_000);
      expect((await h.call("/admin/numbers/order-standing", { caller: "admin", method: "POST" })).status).toBe(200);
    }
    const orders = h.telnyx.requests("POST", "/v2/number_orders");
    expect(orders).toHaveLength(8);
    const searched = ["+14165550170", "+14165550171", "+14165550172", "+14165550173", "+14165550174", "+14165550175", "+14165550176", "+14165550177"];
    expect(orders.map((entry) => (entry.body as { phone_numbers: { phone_number: string }[] }).phone_numbers[0]!.phone_number)).toEqual(searched);
    expect(adopted.tags).toContain("rig-standing");
    expect(deletes(h)).toEqual([]);
  });

  it("records who lifted the stop, why, and which stop it was", async () => {
    const h = await stoppedAfterRobot1();
    await resume(h, { by: "operator-1", reason: "Read-back now lists the number" });
    expect(await h.store.get<OrderingResume[]>(ORDER_KEYS.resumes)).toEqual([
      { at: h.clock.now, by: "operator-1", why: "Read-back now lists the number", cleared: "number_unreadable" },
    ]);
  });

  it("stops ordering again, and says so, when the read-back still cannot list the number", async () => {
    const h = await stoppedAfterRobot1();
    h.telnyx.failNext = { method: "GET", path: "/v2/phone_numbers", status: 403, whenQuery: "filter%5Bphone_number%5D" };
    const response = await resume(h);
    expect(await response.json()).toEqual({ cleared: "number_unreadable", state: "failed" });
    expect(await stoppedReason(h.ctx)).toBe("number_unreadable");
    expect(await h.store.get<OrderingResume[]>(ORDER_KEYS.resumes)).toHaveLength(1);
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toHaveLength(1);
  });

  it("refuses when ordering is not stopped", async () => {
    const h = await ready();
    const response = await resume(h);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ rule: "provisioning.resume_refused" });
    expect(await h.store.get(ORDER_KEYS.resumes)).toBeUndefined();
  });

  it("refuses to lift a stop that is not number_unreadable", async () => {
    const h = await ready();
    await h.store.put(ORDER_KEYS.stopped, { at: h.clock.now, reason: "group_not_kept" });
    const response = await resume(h);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ rule: "provisioning.resume_refused" });
    expect(await stoppedReason(h.ctx)).toBe("group_not_kept");
    expect(await h.store.get(ORDER_KEYS.resumes)).toBeUndefined();
  });

  it("refuses a request that does not say who and why, or whose reason could carry a number", async () => {
    const h = await ready();
    await h.store.put(ORDER_KEYS.stopped, { at: h.clock.now, reason: "number_unreadable" });
    for (const body of [
      {},
      { by: "operator-1" },
      { reason: "Read-back now lists the number" },
      { by: "operator 1", reason: "Read-back now lists the number" },
      { by: "operator-1", reason: "short" },
      { by: "operator-1", reason: "x".repeat(201) },
      { by: "operator-1", reason: "Number is 4165550150 in the portal" },
      { by: "operator-1", reason: "Number is +1 416 in the portal" },
    ]) {
      const response = await resume(h, body);
      expect(response.status, JSON.stringify(body)).toBe(403);
      expect(await response.json()).toMatchObject({ rule: "request.body_invalid" });
    }
    expect(await stoppedReason(h.ctx)).toBe("number_unreadable");
    expect(await h.store.get(ORDER_KEYS.resumes)).toBeUndefined();
  });

  it("refuses while the start-up checks find the partition unsafe", async () => {
    const h = await ready();
    await h.store.put(ORDER_KEYS.stopped, { at: h.clock.now, reason: "number_unreadable" });
    const voice = h.telnyx.lists.call_control_applications.find((item) => item.id === "conn-voice");
    if (voice) voice.webhook_event_url = PROD_WEBHOOK;
    h.advance(24 * 60 * 60 * 1000);
    const response = await resume(h);
    expect(await response.json()).toMatchObject({ rule: "startup.unsafe" });
    expect(await stoppedReason(h.ctx)).toBe("number_unreadable");
    expect(await h.store.get(ORDER_KEYS.resumes)).toBeUndefined();
  });

  it("is an admin route, refused to every other caller", async () => {
    const h = await ready();
    await h.store.put(ORDER_KEYS.stopped, { at: h.clock.now, reason: "number_unreadable" });
    for (const caller of ["rig-api", "robot", "diag", "edge"]) {
      const response = await h.call("/admin/numbers/resume-ordering", { caller, method: "POST", body: { by: "operator-1", reason: "Read-back now lists the number" } });
      expect(response.status, caller).toBe(403);
    }
    expect(await stoppedReason(h.ctx)).toBe("number_unreadable");
  });
});

async function ruleOfOrderStanding(h: Harness): Promise<string | undefined> {
  const response = await h.call("/admin/numbers/order-standing", { caller: "admin", method: "POST" });
  return ((await response.json()) as { rule?: string }).rule;
}

describe("ordering's gate", () => {
  it("waits only on production's partition rule, the first order and a stop", async () => {
    const h = await ready({ validated: null, env: { TELNYX_CONCURRENT_FLOOR: "unknown" } });
    expect(await orderingBlockers(h.ctx)).toEqual([]);
    h.production.capabilities = [];
    h.advance(11 * 60 * 1000);
    expect(await orderingBlockers(h.ctx)).toEqual(["production_lacks_partition_rule"]);
  });
});
