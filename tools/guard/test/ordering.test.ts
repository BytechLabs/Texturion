import { describe, expect, it } from "vitest";

import { CRONS } from "../src/guard";
import { ORDER_KEYS, orderingBlockers, verifyFirstOrder, type FirstOrder } from "../src/telnyx/ordering";
import { lease, ready, type Harness } from "./support";

const ORDERED = "+14165550150";

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

const ordered = (h: Harness) => h.telnyx.numbers.find((item) => item.phone_number === ORDERED);
const deletes = (h: Harness) => h.telnyx.requests("DELETE").map((entry) => entry.path);
const stopAlerts = (h: Harness) => h.outbound.filter((item) => item.body.includes('"fingerprint":["ops","telnyx-guard-order-group"]'));

describe("the first order's read-back", () => {
  it("waits while the order is pending, and judges once Telnyx reports it a success", async () => {
    const h = await ready();
    h.telnyx.orderStatus = "pending";
    h.telnyx.dropGroupOnOrder = true;
    expect(await order(h)).toBe(200);
    // The number is already listed without its group, but the order is not done: nothing is judged.
    expect(await h.store.get<FirstOrder>(ORDER_KEYS.first)).toMatchObject({ state: "pending" });
    expect(await orderingBlockers(h.ctx)).toEqual(["first_order_unverified"]);
    expect(deletes(h)).toEqual([]);

    const number = ordered(h);
    if (number) number.billing_group_id = "bg-nonprod";
    h.telnyx.numberOrders[0]!.status = "success";
    await h.guard.cron(CRONS.upkeep);
    expect(await h.store.get<FirstOrder>(ORDER_KEYS.first)).toMatchObject({ state: "verified" });
    expect(await orderingBlockers(h.ctx)).toEqual([]);
  });

  it("releases only the number the order returned, by its id, when the group did not stick", async () => {
    const h = await ready();
    h.telnyx.dropGroupOnOrder = true;
    const before = h.telnyx.numbers.map((item) => item.id);
    expect(await order(h)).toBe(200);
    const id = (h.telnyx.numberOrders[0]!.phone_numbers as { id: string }[])[0]!.id;
    expect(deletes(h)).toEqual([`/v2/phone_numbers/${id}`]);
    expect(h.telnyx.numbers.map((item) => item.id)).toEqual(before);
    expect(await h.store.get(ORDER_KEYS.stopped)).toMatchObject({ reason: "group_not_kept" });
    expect(stopAlerts(h)).toHaveLength(1);
  });

  it("stops without deleting when the id the order returned is not a number's", async () => {
    const h = await ready();
    h.telnyx.dropGroupOnOrder = true;
    h.telnyx.orderLineIds = true;
    expect(await order(h)).toBe(200);
    expect(deletes(h)).toEqual([]);
    expect(ordered(h)).toBeDefined();
    expect(await h.store.get(ORDER_KEYS.stopped)).toMatchObject({ reason: "number_unreadable" });
    expect(stopAlerts(h)).toHaveLength(1);
    expect(await orderingBlockers(h.ctx)).toContain("stopped_after_group_check");
  });

  it("never matches by phone number alone: an order naming another number stops without deleting", async () => {
    const h = await ready();
    h.telnyx.orderStatus = "pending";
    h.telnyx.dropGroupOnOrder = true;
    await order(h);
    // The order now names a different number than the one the guard ordered.
    const line = (h.telnyx.numberOrders[0]!.phone_numbers as Record<string, unknown>[])[0]!;
    line.phone_number = "+14165550151";
    h.telnyx.numberOrders[0]!.status = "success";
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    expect(deletes(h)).toEqual([]);
    expect(await h.store.get(ORDER_KEYS.stopped)).toMatchObject({ reason: "order_ambiguous" });
  });

  it("stops without deleting when the second read finds the number on production's connection", async () => {
    const h = await ready();
    h.telnyx.orderStatus = "pending";
    await order(h);
    const number = ordered(h);
    if (number) Object.assign(number, { billing_group_id: null, connection_id: "conn-prod-voice" });
    h.telnyx.numberOrders[0]!.status = "success";
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    expect(deletes(h)).toEqual([]);
    expect(await h.store.get(ORDER_KEYS.stopped)).toMatchObject({ reason: "group_not_kept" });
  });

  it("stops without deleting when there is no order id to read", async () => {
    const h = await ready();
    h.telnyx.numbers.push({ id: "num-loose", phone_number: ORDERED, billing_group_id: null, connection_id: null, tags: [] });
    await h.store.put(ORDER_KEYS.first, { state: "pending", order_id: null, phone_number: ORDERED, at: h.clock.now } satisfies FirstOrder);
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    expect(deletes(h)).toEqual([]);
    expect(await h.store.get(ORDER_KEYS.stopped)).toMatchObject({ reason: "order_id_missing" });
    expect(stopAlerts(h)).toHaveLength(1);
  });

  it("asks again after a read that may pass, and forgets an order that failed", async () => {
    const h = await ready();
    h.telnyx.orderStatus = "pending";
    await order(h);
    const orderId = h.telnyx.numberOrders[0]!.id as string;
    h.telnyx.failNext = { method: "GET", path: `/v2/number_orders/${orderId}`, status: 503 };
    expect(await verifyFirstOrder(h.ctx)).toBe("pending");
    expect(await h.store.get(ORDER_KEYS.stopped)).toBeUndefined();
    h.telnyx.numberOrders[0]!.status = "failure";
    await verifyFirstOrder(h.ctx);
    expect(await h.store.get(ORDER_KEYS.first)).toBeUndefined();
    expect(deletes(h)).toEqual([]);
  });

  it("stops without deleting on an order read that cannot pass", async () => {
    const h = await ready();
    h.telnyx.orderStatus = "pending";
    await order(h);
    const orderId = h.telnyx.numberOrders[0]!.id as string;
    h.telnyx.failNext = { method: "GET", path: `/v2/number_orders/${orderId}`, status: 404 };
    expect(await verifyFirstOrder(h.ctx)).toBe("failed");
    expect(await h.store.get(ORDER_KEYS.stopped)).toMatchObject({ reason: "order_unreadable" });
    expect(deletes(h)).toEqual([]);
  });
});

describe("ordering's gate", () => {
  it("waits only on production's partition rule, the first order and a stop", async () => {
    const h = await ready({ validated: null, env: { TELNYX_CONCURRENT_FLOOR: "unknown" } });
    expect(await orderingBlockers(h.ctx)).toEqual([]);
    h.production.capabilities = [];
    h.advance(11 * 60 * 1000);
    expect(await orderingBlockers(h.ctx)).toEqual(["production_lacks_partition_rule"]);
  });
});
