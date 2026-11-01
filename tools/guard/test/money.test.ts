import { describe, expect, it } from "vitest";

import { averageDailySpend, balanceFloor, floorFor, readBalance, requireAboveFloor } from "../src/state/balance";
import { charge, noteHeld, readTier, reconcile, tierOf, type MonthLedger } from "../src/state/ledger";
import { CRONS } from "../src/guard";
import { enforceCap } from "../src/telnyx/detach";
import { loadPartition } from "../src/telnyx/partition";
import { harness, ready, type Harness } from "./support";

const LEDGER: MonthLedger = { usage_usd: 0, one_time_usd: 0, reconciled_usd: 0, peak_numbers: 8, caller_name_numbers: 1 };
/** 2026-11-16, with 15 days left in the month counting today. */
const MID_MONTH = Date.parse("2026-11-16T05:00:00Z");

describe("money tiers", () => {
  it("reserves this month's and next month's rental, one-time fees and the $1.50 set-aside off the $35", () => {
    const reading = tierOf({ ...LEDGER, one_time_usd: 1 }, 0, MID_MONTH);
    // 8 numbers at $1.10 plus one caller-name lookup at $0.40, twice over.
    expect(reading.rentals_usd).toBeCloseTo(9.2);
    expect(reading.next_month_reserve_usd).toBeCloseTo(9.2);
    expect(reading.usage_budget_usd).toBeCloseTo(35 - 9.2 - 9.2 - 1 - 1.5);
  });

  it("is red once usage reaches the budget the set-aside leaves", () => {
    expect(tierOf({ ...LEDGER, usage_usd: 15.09 }, 0, MID_MONTH).tier).toBe("amber");
    expect(tierOf({ ...LEDGER, usage_usd: 15.1 }, 0, MID_MONTH).tier).toBe("red");
  });

  it("spreads what is left of the usage budget over the days left", () => {
    const reading = tierOf({ ...LEDGER, usage_usd: 4 }, 1, MID_MONTH);
    const budget = 35 - 18.4 - 1.5;
    expect(reading.daily_allowance_usd).toBeCloseTo((budget - 3) / 15);
  });

  it("is green under the day's allowance, amber at it, red at the cap", () => {
    expect(tierOf({ ...LEDGER, usage_usd: 0.5 }, 0.5, MID_MONTH).tier).toBe("green");
    expect(tierOf({ ...LEDGER, usage_usd: 1.2 }, 1.2, MID_MONTH).tier).toBe("amber");
    expect(tierOf({ ...LEDGER, usage_usd: 16.6 }, 0, MID_MONTH).tier).toBe("red");
  });

  it("goes amber at 80% of the month's budget even on a quiet day", () => {
    expect(tierOf({ ...LEDGER, usage_usd: 13.3 }, 0, MID_MONTH).tier).toBe("amber");
  });

  it("counts the larger of the estimate and the reconciled actual", async () => {
    const h = harness({ now: MID_MONTH });
    await charge(h.ctx, 2);
    await reconcile(h.ctx, "2026-11", 20);
    expect((await readTier(h.ctx)).month_to_date_usd).toBe(20);
    await reconcile(h.ctx, "2026-11", 1);
    expect((await readTier(h.ctx)).month_to_date_usd).toBe(20);
  });

  it("charges a month's rental for every number held at any point in it", async () => {
    const h = harness({ now: MID_MONTH });
    await noteHeld(h.ctx, 9, 1);
    await noteHeld(h.ctx, 8, 1);
    expect((await readTier(h.ctx)).rentals_usd).toBeCloseTo(9 * 1.1 + 0.4);
  });

  it("counts the rentals of every number held in a month nothing was ordered in", async () => {
    const h = await ready();
    h.clock.now = Date.parse("2026-12-01T05:00:00Z");
    expect((await readTier(h.ctx)).rentals_usd).toBe(0);
    // Any read of the partition notes what is held; /health reads it.
    const health = (await (await h.call("/health", { caller: "admin" })).json()) as { money: Record<string, number> };
    const held = h.telnyx.numbers.filter((item) => item.billing_group_id === "bg-nonprod").length;
    expect(health.money.rentals_usd).toBeCloseTo(held * 1.1);
    expect(health.money.next_month_reserve_usd).toBeCloseTo(held * 1.1);
    expect(health.money.usage_budget_usd).toBeCloseTo(35 - 2 * held * 1.1 - 1.5);
  });

  it("counts a caller-name lookup for each held number whose role has one", async () => {
    const h = await ready();
    const number = h.telnyx.numbers.find((item) => item.id === "num-deva1");
    if (number) number.customer_reference = "rig-standing-dev-a1";
    await loadPartition(h.ctx, { fresh: true });
    expect((await readTier(h.ctx)).rentals_usd).toBeCloseTo(7 * 1.1 + 0.4);
  });

  it("starts each month with an empty ledger", async () => {
    const h = harness({ now: Date.parse("2026-11-30T12:00:00Z") });
    await charge(h.ctx, 36);
    expect((await readTier(h.ctx)).tier).toBe("red");
    h.advance(24 * 60 * 60 * 1000);
    expect((await readTier(h.ctx)).month_to_date_usd).toBe(0);
  });
});

describe("the balance floor", () => {
  it("is $100 or 14 days of the account's spend, whichever is more", () => {
    expect(floorFor([])).toBe(100);
    expect(averageDailySpend([{ day: "a", usd: 500 }, { day: "b", usd: 490 }, { day: "c", usd: 470 }])).toBe(15);
    expect(floorFor([{ day: "a", usd: 500 }, { day: "b", usd: 490 }, { day: "c", usd: 470 }])).toBe(210);
  });

  it("does not read a top-up as negative spend", () => {
    expect(averageDailySpend([{ day: "a", usd: 100 }, { day: "b", usd: 600 }, { day: "c", usd: 590 }])).toBe(5);
  });

  it("samples the balance once a day and refuses below the floor", async () => {
    const h = await ready();
    h.telnyx.balance = "300.00";
    await readBalance(h.ctx, { fresh: true });
    for (let day = 1; day <= 2; day++) {
      h.advance(24 * 60 * 60 * 1000);
      h.telnyx.balance = String(300 - day * 20);
      await readBalance(h.ctx, { fresh: true });
    }
    expect(await balanceFloor(h.ctx)).toBe(280);
    await expect(requireAboveFloor(h.ctx)).rejects.toMatchObject({ rule: "budget.balance_floor" });
  });

  it("fails closed when the balance cannot be read", async () => {
    const h = await ready();
    h.telnyx.failNext = { method: "GET", path: "/v2/balance", status: 500 };
    await expect(requireAboveFloor(h.ctx)).rejects.toMatchObject({ rule: "budget.balance_unknown" });
  });

  it("raises one production alert a day under $150", async () => {
    const h = await ready();
    h.telnyx.balance = "140.00";
    await readBalance(h.ctx, { fresh: true });
    await readBalance(h.ctx, { fresh: true });
    const events = h.outbound.filter((item) => item.body.includes('"fingerprint":["ops","telnyx-balance-low"]'));
    expect(events).toHaveLength(1);
  });
});

describe("the cap", () => {
  const detachEvents = (h: Harness) =>
    h.outbound.filter((item) => item.body.includes('"fingerprint":["ops","telnyx-guard-detach"]'));

  it("detaches every number off the robot's connection, and nothing twice", async () => {
    const h = await ready();
    await charge(h.ctx, 40);
    const view = await loadPartition(h.ctx);
    const detached = await enforceCap(h.ctx, view);
    expect(detached).toBe(4);
    const robot = h.telnyx.numbers.filter((item) => item.connection_id === "conn-robot");
    expect(robot.map((item) => item.id).sort()).toEqual(["num-robot1", "num-robot2", "num-stranger1"]);
    expect(h.telnyx.numbers.find((item) => item.id === "num-prod")?.connection_id).toBe("conn-prod-voice");
    expect(await enforceCap(h.ctx, await loadPartition(h.ctx, { fresh: true }))).toBe(0);
    expect(detachEvents(h)).toEqual([]);
  });

  it("raises a production event when a number will not detach, and retries it on the hourly upkeep", async () => {
    const h = await ready();
    await charge(h.ctx, 40);
    h.telnyx.failNext = { method: "PATCH", path: "/v2/phone_numbers/num-devw1", status: 500 };
    expect(await enforceCap(h.ctx, await loadPartition(h.ctx))).toBe(3);
    expect(h.telnyx.numbers.find((item) => item.id === "num-devw1")?.connection_id).toBe("conn-voice");
    expect(detachEvents(h)).toHaveLength(1);

    h.advance(60 * 60 * 1000);
    await h.guard.cron(CRONS.upkeep);
    expect(h.telnyx.numbers.find((item) => item.id === "num-devw1")).toMatchObject({
      connection_id: "",
      messaging_profile_id: "",
    });
    expect(detachEvents(h)).toHaveLength(1);
  });

  it("alerts at most once a day while a detach keeps failing", async () => {
    const h = await ready();
    await charge(h.ctx, 40);
    const realHandle = h.telnyx.handle.bind(h.telnyx);
    h.telnyx.handle = async (request) =>
      request.method === "PATCH" && new URL(request.url).pathname === "/v2/phone_numbers/num-devw2"
        ? new Response("{}", { status: 422 })
        : realHandle(request);
    for (let i = 0; i < 3; i++) await enforceCap(h.ctx, await loadPartition(h.ctx, { fresh: true }));
    expect(h.telnyx.numbers.find((item) => item.id === "num-devw2")?.connection_id).toBe("conn-voice");
    expect(detachEvents(h)).toHaveLength(1);
  });
});
