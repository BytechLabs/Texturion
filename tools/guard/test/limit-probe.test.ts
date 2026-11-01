import { describe, expect, it } from "vitest";

import { CRONS } from "../src/guard";
import { LIMIT_PROBE_MAX_WRITES } from "../src/limits";
import { limitProbeDue, runLimitProbe } from "../src/setup/limit-probe";
import { runSafetyChecks } from "../src/setup/safety";
import { LIMIT_KEYS, limitInForce, recordCeiling, type ValidationRecord } from "../src/state/concurrency";
import { KEYS, ready, ruleOf, type Harness } from "./support";

const DAY = 24 * 60 * 60 * 1000;
const PROBE = "/v2/outbound_voice_profiles/ovp-probe";

/** Every write the probe sent, as the values it asked for. */
function writes(h: Harness): { path: string; value: unknown; name: unknown }[] {
  return h.telnyx.requests("PATCH").map((entry) => {
    const body = entry.body as { concurrent_call_limit?: unknown; name?: unknown };
    return { path: entry.path, value: body.concurrent_call_limit, name: body.name };
  });
}

function profile(h: Harness, id: string) {
  return h.telnyx.lists.outbound_voice_profiles.find((item) => item.id === id);
}

async function probed(options: { mode: "refuse-above" | "accept" | "error"; limit?: number }) {
  const h = await ready({ validated: null });
  h.telnyx.profileLimit = { mode: options.mode, limit: options.limit ?? 0 };
  const result = await runLimitProbe(h.ctx);
  return { h, result };
}

describe("the validation check", () => {
  it("finds the largest value Telnyx accepts, from an absurd first write, and puts the profile back to 1", async () => {
    const { h, result } = await probed({ mode: "refuse-above", limit: 4 });
    expect(result).toMatchObject({ result: "exact", value: 4, refusal_code: "10015" });
    const sent = writes(h);
    expect(sent[0]).toMatchObject({ path: PROBE, value: 9999, name: "nonprod-limit-probe-ovp" });
    expect(sent.at(-1)).toMatchObject({ path: PROBE, value: 1 });
    expect(sent.length).toBeLessThanOrEqual(LIMIT_PROBE_MAX_WRITES);
    expect(result.writes).toBe(sent.length);
    // Both ends were written: 4 accepted, 5 refused.
    expect(sent.map((item) => item.value)).toEqual(expect.arrayContaining([4, 5]));
    expect(profile(h, "ovp-probe")?.concurrent_call_limit).toBe(1);
    expect(await h.store.get<ValidationRecord>(LIMIT_KEYS.validation)).toMatchObject({ result: "exact", value: 4 });
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 4, source: "validation" });
  });

  it("stays within its write budget wherever the boundary is", async () => {
    for (const limit of [1, 2, 5, 6, 10, 100, 4_999, 9_998]) {
      const { h, result } = await probed({ mode: "refuse-above", limit });
      expect(result, String(limit)).toMatchObject({ result: "exact", value: limit });
      expect(writes(h).length, String(limit)).toBeLessThanOrEqual(LIMIT_PROBE_MAX_WRITES);
      expect(writes(h).at(-1)?.value).toBe(1);
    }
  });

  it("calls an accepted absurd value not enforced, and leaves the limit unproven", async () => {
    const { h, result } = await probed({ mode: "accept" });
    expect(result).toMatchObject({ result: "not_enforced", value: null });
    expect(writes(h).map((item) => item.value)).toEqual([9999, 1]);
    expect(profile(h, "ovp-probe")?.concurrent_call_limit).toBe(1);
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 2, source: "floor" });
  });

  it("aborts as inconclusive on a 500, still asks for the reset, and says when the reset failed", async () => {
    const { h, result } = await probed({ mode: "error" });
    expect(result).toMatchObject({ result: "inconclusive", value: null });
    expect(writes(h).map((item) => item.value)).toEqual([9999, 1]);
    const alert = h.outbound.find((item) => item.body.includes("telnyx-guard-limit-probe-reset"));
    expect(alert).toBeDefined();
    expect(await limitInForce(h.ctx)).toMatchObject({ source: "floor" });
  });

  it("treats a refusal that does not name the field, a 429 or a 404 as inconclusive", async () => {
    const answers = [
      { status: 422, body: { errors: [{ code: "10015", detail: "name is too short", source: { pointer: "/name" } }] } },
      { status: 429, body: { errors: [{ code: "10011", detail: "concurrent_call_limit rate limited" }] } },
      { status: 404, body: { errors: [{ code: "10005" }] } },
    ];
    for (const answer of answers) {
      const h = await ready({ validated: null });
      h.telnyx.failNext = { method: "PATCH", path: PROBE, ...answer };
      expect((await runLimitProbe(h.ctx)).result, String(answer.status)).toBe("inconclusive");
      expect(writes(h).map((item) => item.value)).toEqual([9999, 1]);
    }
  });

  it("aborts when a later refusal is a different error from the first", async () => {
    const h = await ready({ validated: null });
    h.telnyx.profileLimit = { mode: "refuse-above", limit: 6 };
    const realHandle = h.telnyx.handle.bind(h.telnyx);
    h.telnyx.handle = async (request) => {
      const body = request.method === "PATCH" ? ((await request.clone().json()) as { concurrent_call_limit?: number }) : {};
      if (body.concurrent_call_limit === 4999) {
        return Response.json({ errors: [{ code: "10099", source: { pointer: "/concurrent_call_limit" } }] }, { status: 422 });
      }
      return realHandle(request);
    };
    expect((await runLimitProbe(h.ctx)).result).toBe("inconclusive");
  });

  it("keeps each write's status, code and field in the record, and not Telnyx's words", async () => {
    const { h, result } = await probed({ mode: "refuse-above", limit: 4 });
    expect(result.trace?.[0]).toEqual({ value: 9999, status: 422, code: "10015", pointer: "/concurrent_call_limit" });
    expect(result.trace?.at(-1)).toEqual({ value: 1, status: 200, code: null, pointer: null });
    expect(result.trace).toHaveLength(result.writes);
    expect(JSON.stringify(await h.store.get(LIMIT_KEYS.validation))).not.toContain("global concurrent call limit");
  });

  it("writes only the probe profile, never the voice, robot or production profiles", async () => {
    const { h } = await probed({ mode: "refuse-above", limit: 9 });
    expect(new Set(writes(h).map((item) => item.path))).toEqual(new Set([PROBE]));
    for (const id of ["ovp-voice", "ovp-robot", "ovp-prod"]) expect(profile(h, id)?.concurrent_call_limit).toBeUndefined();
  });

  it("writes nothing when the name resolves to a profile the partition dials on", async () => {
    const h = await ready({ validated: null });
    const record = await h.store.get<{ outbound_voice_profiles: Record<string, string> }>(KEYS.record);
    await h.store.put(KEYS.record, { ...record, outbound_voice_profiles: { voice: "ovp-probe", robot: "ovp-robot" } });
    expect(await runLimitProbe(h.ctx)).toMatchObject({ result: "inconclusive", writes: 0 });
    expect(h.telnyx.requests("PATCH")).toEqual([]);
  });

  it("writes nothing while the probe profile is unsafe: two of that name, or one a connection uses", async () => {
    const twice = await ready({ validated: null });
    twice.telnyx.lists.outbound_voice_profiles.push({ id: "ovp-probe-2", name: "nonprod-limit-probe-ovp" });
    await runSafetyChecks(twice.ctx);
    await expect(runLimitProbe(twice.ctx)).rejects.toMatchObject({ rule: "startup.unsafe" });
    expect(twice.telnyx.requests("PATCH")).toEqual([]);

    const used = await ready({ validated: null });
    const app = used.telnyx.lists.call_control_applications.find((item) => item.id === "conn-prod-voice");
    if (app) app.outbound = { outbound_voice_profile_id: "ovp-probe" };
    await runSafetyChecks(used.ctx);
    await expect(runLimitProbe(used.ctx)).rejects.toMatchObject({ rule: "startup.unsafe" });
    expect(used.telnyx.requests("PATCH")).toEqual([]);
  });

  it("writes nothing to a profile outside the partition's group, or one a connection took since the last check", async () => {
    const elsewhere = await ready({ validated: null });
    const found = profile(elsewhere, "ovp-probe");
    if (found) found.billing_group_id = "bg-production";
    expect(await runLimitProbe(elsewhere.ctx)).toMatchObject({ result: "inconclusive", writes: 0 });
    expect(elsewhere.telnyx.requests("PATCH")).toEqual([]);

    const taken = await ready({ validated: null });
    const app = taken.telnyx.lists.call_control_applications.find((item) => item.id === "conn-prod-voice");
    if (app) app.outbound = { outbound_voice_profile_id: "ovp-probe" };
    expect(await runLimitProbe(taken.ctx)).toMatchObject({ result: "inconclusive", writes: 0 });
    expect(taken.telnyx.requests("PATCH")).toEqual([]);
  });

  it("calls a run in which Telnyx refuses even 1 inconclusive, keeps the earlier result and still resets", async () => {
    const h = await ready({ validated: 6 });
    h.telnyx.profileLimit = { mode: "refuse-above", limit: 0 };
    expect(await runLimitProbe(h.ctx)).toMatchObject({ result: "inconclusive", value: null });
    expect(writes(h).map((item) => item.value)).toEqual(expect.arrayContaining([9999, 1]));
    expect(writes(h).at(-1)?.value).toBe(1);
    expect(await h.store.get<ValidationRecord>(LIMIT_KEYS.validation)).toMatchObject({ result: "exact", value: 6 });
  });

  it("never lets an inconclusive run replace a conclusive result", async () => {
    const h = await ready({ validated: 6 });
    h.telnyx.profileLimit = { mode: "error", limit: 0 };
    await runLimitProbe(h.ctx);
    expect(await h.store.get<ValidationRecord>(LIMIT_KEYS.validation)).toMatchObject({ result: "exact", value: 6 });
  });
});

describe("when the validation check runs", () => {
  it("runs from the hourly upkeep while nothing is proven, at most once a day", async () => {
    const h = await ready({ validated: null });
    h.telnyx.profileLimit = { mode: "error", limit: 0 };
    await h.guard.cron(CRONS.upkeep);
    expect(writes(h)).toHaveLength(2);
    h.advance(60 * 60 * 1000);
    await h.guard.cron(CRONS.upkeep);
    expect(writes(h)).toHaveLength(2);
    h.advance(DAY);
    h.telnyx.profileLimit = { mode: "refuse-above", limit: 4 };
    await h.guard.cron(CRONS.upkeep);
    expect(await limitInForce(h.ctx)).toMatchObject({ limit: 4, source: "validation" });
  });

  it("runs again once a conclusive result is 30 days old", async () => {
    const h = await ready();
    expect(await limitProbeDue(h.ctx)).toBe(false);
    h.advance(29 * DAY);
    expect(await limitProbeDue(h.ctx)).toBe(false);
    h.advance(DAY);
    expect(await limitProbeDue(h.ctx)).toBe(true);
  });

  it("runs again once Telnyx has refused for a limit since the result was measured", async () => {
    const h = await ready();
    h.advance(DAY);
    expect(await limitProbeDue(h.ctx)).toBe(false);
    await recordCeiling(h.ctx, { value: null, from: "telnyx-90041" });
    expect(await limitProbeDue(h.ctx)).toBe(true);
  });

  it("runs on the admin route, for the admin class only", async () => {
    const h = await ready({ validated: null });
    h.telnyx.profileLimit = { mode: "refuse-above", limit: 4 };
    expect(await ruleOf(await h.call("/admin/limit-probe", { caller: "robot", method: "POST" }))).toBe("class.not_allowed");
    const response = await h.call("/admin/limit-probe", { caller: "admin", method: "POST" });
    expect(await response.json()).toMatchObject({ result: "exact", value: 4 });
  });
});
