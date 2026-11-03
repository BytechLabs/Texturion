import { HEADER } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { limitRule, roomFor } from "../src/state/admission";
import {
  LIMIT_KEYS,
  limitInForce,
  recordCeiling,
  roomUnder,
  type HistoryRecord,
  type ValidationRecord,
} from "../src/state/concurrency";
import { fileValidation, harness, lease, ready, registerViaEdge, ruleOf, type Harness } from "./support";

const DAY = 24 * 60 * 60 * 1000;

async function history(h: Harness, peak: number, at = h.clock.now): Promise<void> {
  await h.store.put(LIMIT_KEYS.history, { peak_calls: peak, measured_at: at } satisfies HistoryRecord);
}

async function validation(h: Harness, record: Partial<ValidationRecord>): Promise<void> {
  await h.store.put(LIMIT_KEYS.validation, {
    result: "exact",
    value: 5,
    measured_at: h.clock.now,
    writes: 15,
    refusal_code: "10015",
    ...record,
  } satisfies ValidationRecord);
}

const conflictAlerts = (h: Harness) =>
  h.outbound.filter((item) => item.body.includes('"$exception_fingerprint":"ops:telnyx-guard-limit-conflict"'));
const cappedAlerts = (h: Harness) =>
  h.outbound.filter((item) => item.body.includes('"$exception_fingerprint":"ops:telnyx-guard-limit-capped"'));

describe("the limit in force", () => {
  it("is the floor, with no room at all, while nothing else is proven", async () => {
    const h = harness();
    const concurrency = await limitInForce(h.ctx);
    expect(concurrency).toMatchObject({ limit: 2, source: "floor", floor: 2, validation: null, history: null, ceiling: null, conflict: null });
    const reserve = { legs: 0, measured_at: h.clock.now };
    expect(roomFor(concurrency, reserve, h.clock.now)).toBe(0);
    expect(roomFor(concurrency, { legs: 1, measured_at: h.clock.now }, h.clock.now)).toBe(0);
    expect(limitRule(concurrency, 1)?.rule).toBe("admission.limit_unproven");
    expect(limitRule(concurrency, 0)).toBeNull();
  });

  it("is nothing at all when the floor is unparseable, whatever else is filed", async () => {
    const h = harness({ env: { TELNYX_CONCURRENT_FLOOR: "two" } });
    await fileValidation(h);
    const concurrency = await limitInForce(h.ctx);
    expect(concurrency).toMatchObject({ limit: null, floor: null });
    expect(limitRule(concurrency, 0)?.rule).toBe("admission.limit_unknown");
    expect(roomFor(concurrency, { legs: 0, measured_at: h.clock.now }, h.clock.now)).toBeNull();
  });

  it("is a fresh exact validation, capped by the lowest valued ceiling", async () => {
    const h = harness();
    await validation(h, { value: 5 });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 5, source: "validation" });
    expect(roomUnder(await limitInForce(h.ctx), 3)).toBe(2);
    await recordCeiling(h.ctx, { value: 4, from: "telnyx-90041" });
    await recordCeiling(h.ctx, { value: 6, from: "telnyx-90042" });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 4, source: "validation", ceiling: { value: 4, from: "telnyx-90041" } });
  });

  it("counts a validation above Paid's 5 only as far as production's history corroborates, and warns once per value", async () => {
    const h = harness();
    await validation(h, { value: 40 });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 5, source: "validation" });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 5 });
    expect(cappedAlerts(h)).toHaveLength(1);
    await history(h, 7);
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 7, source: "validation", conflict: null });
    await validation(h, { value: 6 });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 6 });
    expect(cappedAlerts(h)).toHaveLength(1);
  });

  it("stays the floor when the check found the rule not enforced, or could not tell", async () => {
    for (const result of ["not_enforced", "inconclusive"] as const) {
      const h = harness();
      await validation(h, { result, value: null });
      expect(await limitInForce(h.ctx), result).toMatchObject({ limit: 2, source: "floor" });
    }
  });

  it("never opens room on the history bound alone", async () => {
    const h = harness();
    await history(h, 4);
    const concurrency = await limitInForce(h.ctx);
    expect(concurrency).toMatchObject({ limit: 2, source: "floor", history: 4, conflict: null });
    expect(roomUnder(concurrency, 0)).toBe(0);
    expect(limitRule(concurrency, 1)?.rule).toBe("admission.limit_unproven");
  });

  it("takes a validation at or above the history bound", async () => {
    const h = harness();
    await history(h, 4);
    await validation(h, { value: 5 });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 5, source: "validation", conflict: null });
  });

  it("lets each kind of evidence lapse after 35 days", async () => {
    const h = harness();
    const old = h.clock.now - 35 * DAY - 1;
    await validation(h, { value: 5, measured_at: old });
    await history(h, 4, old);
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 2, source: "floor", history: null });
    await validation(h, { value: 5, measured_at: h.clock.now - 35 * DAY });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 5, source: "validation" });

    await recordCeiling(h.ctx, { value: 3, from: "telnyx-90041" });
    expect((await limitInForce(h.ctx)).limit).toBe(3);
    h.advance(35 * DAY + 1);
    await validation(h, { value: 5 });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 5, ceiling: null });
    expect(await h.store.get(LIMIT_KEYS.ceiling)).toHaveLength(1);
    await recordCeiling(h.ctx, { value: null, from: "telnyx-90042" });
    // Writing a new ceiling drops the lapsed ones.
    expect(await h.store.get(LIMIT_KEYS.ceiling)).toEqual([{ value: null, from: "telnyx-90042", at: h.clock.now }]);
  });

  it("shows a value-less ceiling without moving the limit", async () => {
    const h = harness();
    await validation(h, { value: 5 });
    await recordCeiling(h.ctx, { value: null, from: "telnyx-90043" });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 5, ceiling: { value: null, from: "telnyx-90043" }, conflict: null });
  });
});

describe("a conflict in the evidence", () => {
  it("is history above a valued ceiling", async () => {
    const h = harness();
    await history(h, 6);
    await recordCeiling(h.ctx, { value: 5, from: "level:paid_or_below" });
    const concurrency = await limitInForce(h.ctx);
    expect(concurrency.conflict).toBe("history_above_ceiling");
    expect(limitRule(concurrency, 0)?.rule).toBe("admission.limit_conflict");
    expect(roomUnder(concurrency, 0)).toBe(0);
  });

  it("is the floor above a valued ceiling", async () => {
    const h = harness();
    await recordCeiling(h.ctx, { value: 1, from: "telnyx-90041" });
    expect((await limitInForce(h.ctx)).conflict).toBe("floor_above_ceiling");
  });

  it("is a validation below the history bound", async () => {
    const h = harness();
    await validation(h, { value: 3 });
    await history(h, 4);
    expect((await limitInForce(h.ctx)).conflict).toBe("validation_below_history");
  });

  it("alerts production once, and again only after it cleared and came back", async () => {
    const h = harness();
    await validation(h, { value: 3 });
    await history(h, 4);
    for (let i = 0; i < 3; i++) await limitInForce(h.ctx);
    expect(conflictAlerts(h)).toHaveLength(1);
    await history(h, 3);
    expect((await limitInForce(h.ctx)).conflict).toBeNull();
    await history(h, 5);
    await limitInForce(h.ctx);
    expect(conflictAlerts(h)).toHaveLength(2);
  });

  it("refuses a bridge too, though it adds no leg", async () => {
    const h = await ready();
    await history(h, 7);
    const id = await lease(h);
    await registerViaEdge(h, "ccid-1");
    await registerViaEdge(h, "ccid-2", "conn-robot", "robot");
    const bridge = await h.call("/telnyx/v2/calls/ccid-1/actions/bridge", {
      body: { call_control_id: "ccid-2" },
      headers: { [HEADER.lease]: id },
    });
    expect(await ruleOf(bridge)).toBe("admission.limit_conflict");
  });
});

describe("level evidence from the robot", () => {
  const post = (h: Harness, body: unknown, caller = "robot") => h.call("/evidence/level", { caller, body });

  it("caps the limit at the Paid level's 5 when the robot heard the announcement", async () => {
    const h = await ready();
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 5, ceiling: null });
    const response = await post(h, { announcement_ms: 4_200, at: new Date(h.clock.now).toISOString() });
    expect(await response.json()).toEqual({ recorded: true, level: "paid_or_below" });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 5, ceiling: { value: 5, from: "level:paid_or_below" } });
  });

  it("records nothing for a call with no announcement, and can never raise the limit", async () => {
    const h = await ready({ validated: 3 });
    expect(await (await post(h, { announcement_ms: 0, at: new Date(h.clock.now).toISOString() })).json()).toEqual({ recorded: false });
    expect(await h.store.get(LIMIT_KEYS.ceiling)).toBeUndefined();
    await post(h, { announcement_ms: 900, at: new Date(h.clock.now).toISOString() });
    expect((await limitInForce(h.ctx)).limit).toBe(3);
  });

  it("is the robot's alone, and refuses a malformed body", async () => {
    const h = await ready();
    const at = new Date(h.clock.now).toISOString();
    for (const caller of ["rig-api", "admin", "diag", "edge"]) {
      expect(await ruleOf(await post(h, { announcement_ms: 10, at }, caller)), caller).toBe("class.not_allowed");
    }
    for (const body of [{ at }, { announcement_ms: -1, at }, { announcement_ms: "10", at }, { announcement_ms: 10 }, { announcement_ms: 10, at: "soon" }]) {
      expect(await ruleOf(await post(h, body)), JSON.stringify(body)).toBe("request.body_invalid");
    }
    expect(await ruleOf(await h.call("/evidence/other", { caller: "robot", body: { announcement_ms: 10, at } }))).toBe("route.unknown");
    expect(await ruleOf(await h.call("/evidence/level", { caller: "robot" }))).toBe("route.unknown");
    expect(await h.store.get(LIMIT_KEYS.ceiling)).toBeUndefined();
  });
});

describe("production's measurements of concurrency and dial peaks", () => {
  const admin = (h: Harness, path: string, body: unknown) => h.call(`/admin${path}`, { caller: "admin", body });

  it("files the history bound and the dial peaks, never later than now", async () => {
    const h = harness();
    const future = new Date(h.clock.now + DAY).toISOString();
    expect(await (await admin(h, "/concurrency-history", { peak_calls: 3, measured_at: future })).json()).toEqual({
      peak_calls: 3,
      measured_at: h.clock.now,
    });
    expect(await (await admin(h, "/account-rate", { peak_hour_dials: 2, peak_day_dials: 9 })).json()).toEqual({
      peak_hour_dials: 2,
      peak_day_dials: 9,
      measured_at: h.clock.now,
    });
  });

  it("refuses counts that are not whole numbers, or an hour above its day", async () => {
    const h = harness();
    for (const body of [{}, { peak_calls: -1 }, { peak_calls: 2.5 }, { peak_calls: "3" }]) {
      expect(await ruleOf(await admin(h, "/concurrency-history", body)), JSON.stringify(body)).toBe("request.body_invalid");
    }
    for (const body of [{ peak_hour_dials: 1 }, { peak_hour_dials: 5, peak_day_dials: 4 }, { peak_hour_dials: 1, peak_day_dials: 2, measured_at: "x" }]) {
      expect(await ruleOf(await admin(h, "/account-rate", body)), JSON.stringify(body)).toBe("request.body_invalid");
    }
    expect(await h.store.get(LIMIT_KEYS.history)).toBeUndefined();
  });
});
