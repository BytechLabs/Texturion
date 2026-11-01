import { HEADER, LEASE_MAX_MS } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { ADMISSION_KEYS } from "../src/state/admission";
import { LIMIT_KEYS, limitInForce, type Ceiling } from "../src/state/concurrency";
import { charge } from "../src/state/ledger";
import { recordSignal } from "../src/state/signals";
import {
  EDGE,
  fileValidation,
  harness,
  lease,
  MONDAY_0500,
  N,
  ready,
  registerViaEdge,
  ruleOf,
  seedAccount,
  type Harness,
} from "./support";
import { runSafetyChecks } from "../src/setup/safety";

const DIAL = {
  connection_id: "conn-robot",
  from: N.robot1,
  to: N.devW1,
  timeout_secs: 30,
};

async function dial(h: Harness, leaseId: string | null, body: Record<string, unknown> = DIAL, scenario?: string) {
  const headers: Record<string, string> = {};
  if (leaseId) headers[HEADER.lease] = leaseId;
  if (scenario) headers[HEADER.scenario] = scenario;
  return h.call("/telnyx/v2/calls", { caller: "robot", body, headers });
}

describe("dial", () => {
  it("places a call between owned numbers under a live lease, and registers the new leg", async () => {
    const h = await ready();
    const id = await lease(h);
    const response = await dial(h, id);
    expect(response.status).toBe(200);
    const ccid = ((await response.json()) as { data: { call_control_id: string } }).data.call_control_id;
    const entry = await h.store.get<{ connection_id: string; via: string }>(`leg:${ccid}`);
    expect(entry).toMatchObject({ connection_id: "conn-robot", via: "robot" });
  });

  it("needs a lease header naming the live lease", async () => {
    const h = await ready();
    expect(await ruleOf(await dial(h, null))).toBe("dial.lease_missing");
    expect(await ruleOf(await dial(h, "not-a-lease"))).toBe("dial.lease_not_live");
    const id = await lease(h);
    h.advance(LEASE_MAX_MS + 1);
    expect(await ruleOf(await dial(h, id))).toBe("dial.lease_not_live");
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
  });

  it("lets the app's own dial run under the live lease without the header, and only then", async () => {
    const h = await ready();
    const appDial = (headers: Record<string, string> = {}) =>
      h.call("/telnyx/v2/calls", {
        caller: "rig-api",
        body: { ...DIAL, connection_id: "conn-voice", from: N.devW1, to: "sip:gencredowner@sip.telnyx.com" },
        headers,
      });
    expect(await ruleOf(await appDial())).toBe("dial.lease_not_live");
    const id = await lease(h);
    expect((await appDial()).status).toBe(200);
    expect(await ruleOf(await appDial({ [HEADER.lease]: "another-lease" }))).toBe("dial.lease_not_live");
    expect((await appDial({ [HEADER.lease]: id })).status).toBe(200);
    // Test code names its lease.
    expect(await ruleOf(await dial(h, null))).toBe("dial.lease_missing");
  });

  it("admits no dial under a lease taken for a run that dials nothing", async () => {
    const h = await ready();
    const response = await h.call("/lease", { caller: "rig-api", body: { scenario: "S34", dials: false } });
    const id = ((await response.json()) as { lease_id: string }).lease_id;
    const appDial = h.call("/telnyx/v2/calls", {
      caller: "rig-api",
      body: { ...DIAL, connection_id: "conn-voice", from: N.devW1, to: "sip:gencredowner@sip.telnyx.com" },
    });
    expect(await ruleOf(await appDial)).toBe("dial.lease_not_live");
    expect(await ruleOf(await dial(h, id))).toBe("dial.lease_not_live");
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
  });

  it("refuses a released lease", async () => {
    const h = await ready();
    const id = await lease(h);
    expect((await h.call(`/lease/${id}`, { caller: "robot", method: "DELETE" })).status).toBe(200);
    expect(await ruleOf(await dial(h, id))).toBe("dial.lease_not_live");
  });

  it("dials only on the two nonprod Call Control apps", async () => {
    const h = await ready();
    const id = await lease(h);
    for (const connection_id of ["conn-prod-voice", "conn-webrtc", "conn-sentinel", undefined]) {
      expect(await ruleOf(await dial(h, id, { ...DIAL, connection_id })), String(connection_id)).toBe(
        "dial.connection_not_nonprod",
      );
    }
  });

  it("needs an owned from", async () => {
    const h = await ready();
    const id = await lease(h);
    for (const from of [N.notOwned, N.production, "anonymous", undefined]) {
      expect(await ruleOf(await dial(h, id, { ...DIAL, from })), String(from)).toBe("dial.from_not_owned");
    }
  });

  it("needs an owned to, or a SIP user on nonprod-webrtc", async () => {
    const h = await ready();
    const id = await lease(h);
    for (const to of [
      N.notOwned,
      N.production,
      "sip:gencredprod@sip.telnyx.com",
      "sip:gencredsentinel@sip.telnyx.com",
      "sip:gencredowner@sip.elsewhere.example",
      "sip:nobody@sip.telnyx.com",
      [N.devW1, N.notOwned],
      [],
    ]) {
      expect(await ruleOf(await dial(h, id, { ...DIAL, to })), JSON.stringify(to)).toBe("dial.to_not_owned");
    }
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
    expect((await dial(h, id, { ...DIAL, connection_id: "conn-voice", to: "sip:gencredowner@sip.telnyx.com" })).status).toBe(
      200,
    );
  });

  it("refuses body fields that reach past the partition", async () => {
    const h = await ready();
    const id = await lease(h);
    for (const extra of [
      { conference_config: { conference_name: "production-room" } },
      { link_to: "ccid-production" },
      { supervise_call_control_id: "ccid-production" },
      { webhook_url: "https://somewhere.example" },
      { stream_url: "wss://somewhere.example" },
      { sip_auth_username: "u", sip_auth_password: "p" },
      { billing_group_id: "bg-production" },
      { conversation_relay_config: { url: "wss://x.example" } },
    ]) {
      expect(await ruleOf(await dial(h, id, { ...DIAL, ...extra })), JSON.stringify(extra)).toBe("dial.field_refused");
    }
    expect((await dial(h, id, { ...DIAL, webhook_url: `${EDGE}/t/r`, billing_group_id: "bg-nonprod" })).status).toBe(200);
  });

  it("gives back the day's dial and the money when Telnyx refuses outright", async () => {
    const h = await ready();
    const id = await lease(h);
    h.telnyx.failNext = { method: "POST", path: "/v2/calls", status: 422 };
    expect((await dial(h, id)).status).toBe(422);
    expect(await h.store.get("count:dials:2026-11-02")).toBe(0);
    expect((await h.store.get<{ usage_usd: number }>("money:month:2026-11"))?.usage_usd).toBe(0);
  });

  it("keeps the charge on an ambiguous failure", async () => {
    const h = await ready();
    const id = await lease(h);
    h.telnyx.failNext = { method: "POST", path: "/v2/calls", status: 503 };
    expect((await dial(h, id)).status).toBe(503);
    expect(await h.store.get("count:dials:2026-11-02")).toBe(1);
  });
});

describe("transfer and bridge", () => {
  it("transfers a registered leg only to an allowed target", async () => {
    const h = await ready();
    const id = await lease(h);
    await registerViaEdge(h, "ccid-1");
    const transfer = (body: Record<string, unknown>, ccid = "ccid-1") =>
      h.call(`/telnyx/v2/calls/${ccid}/actions/transfer`, { body, headers: { [HEADER.lease]: id } });
    expect(await ruleOf(await transfer({ to: N.notOwned }))).toBe("dial.to_not_owned");
    expect(await ruleOf(await transfer({ to: N.devW2, from: N.notOwned }))).toBe("dial.from_not_owned");
    expect(await ruleOf(await transfer({ to: N.devW2 }, "ccid-production"))).toBe("dial.leg_not_registered");
    expect((await transfer({ to: "sip:gencredowner@sip.telnyx.com", from: N.robot1 })).status).toBe(200);
  });

  it("bridges only two registered legs, and refuses a queue or room", async () => {
    const h = await ready();
    const id = await lease(h);
    await registerViaEdge(h, "ccid-1");
    await registerViaEdge(h, "ccid-2", "conn-robot", "robot");
    const bridge = (body: Record<string, unknown>) =>
      h.call("/telnyx/v2/calls/ccid-1/actions/bridge", { body, headers: { [HEADER.lease]: id } });
    expect(await ruleOf(await bridge({ call_control_id: "ccid-production" }))).toBe("dial.leg_not_registered");
    expect(await ruleOf(await bridge({ call_control_id: "ccid-2", queue: "support" }))).toBe("dial.field_refused");
    expect((await bridge({ call_control_id: "ccid-2" })).status).toBe(200);
    // A bridge adds no leg, so it spends no dial.
    expect((await h.store.get("count:dials:2026-11-02")) ?? 0).toBe(0);
  });
});

/** Telnyx's refusal of the next dial, with one error code. */
function refuseNextDial(h: Harness, status: number, code: string) {
  h.telnyx.failNext = { method: "POST", path: "/v2/calls", status, body: { errors: [{ code, title: "refused" }] } };
}

describe("admission", () => {
  it("keeps paid dials off while the concurrency floor is unparseable, whatever else is proven", async () => {
    const h = await ready({ env: { TELNYX_CONCURRENT_FLOOR: "unknown" } });
    const id = await lease(h);
    expect(await ruleOf(await dial(h, id))).toBe("admission.limit_unknown");
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
  });

  it("adds no leg while only the floor is proven, even with a reserve the old formula left room beside", async () => {
    // Floor 2, reserve 1: limit minus reserve would leave room 1, yet the floor alone admits none.
    const h = await ready({ validated: null });
    await h.store.put(ADMISSION_KEYS.reserve, { legs: 1, measured_at: h.clock.now });
    const id = await lease(h);
    expect(await ruleOf(await dial(h, id))).toBe("admission.limit_unproven");
    await registerViaEdge(h, "ccid-1");
    const transfer = await h.call("/telnyx/v2/calls/ccid-1/actions/transfer", {
      body: { to: N.devW2 },
      headers: { [HEADER.lease]: id },
    });
    expect(await ruleOf(transfer)).toBe("admission.limit_unproven");
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
  });

  it("still judges a bridge, which adds no leg, by the other rules while only the floor is proven", async () => {
    const h = await ready({ validated: null });
    const id = await lease(h);
    await registerViaEdge(h, "ccid-1");
    await registerViaEdge(h, "ccid-2", "conn-robot", "robot");
    const bridge = () =>
      h.call("/telnyx/v2/calls/ccid-1/actions/bridge", { body: { call_control_id: "ccid-2" }, headers: { [HEADER.lease]: id } });
    expect((await bridge()).status).toBe(200);
    await h.store.delete(ADMISSION_KEYS.ratios);
    expect(await ruleOf(await bridge())).toBe("admission.ratios_unknown");
  });

  it("admits up to the validated limit less the reserve: V=4 with reserve 2 is two legs", async () => {
    const h = await ready({ validated: 4 });
    const id = await lease(h);
    expect((await dial(h, id)).status).toBe(200);
    expect((await dial(h, id, { ...DIAL, to: N.devW2 })).status).toBe(200);
    expect(await ruleOf(await dial(h, id, { ...DIAL, to: N.devA1 }))).toBe("admission.no_room");
  });

  it("refuses on a conflict in the evidence, and alerts production once", async () => {
    const h = await ready({ validated: 3 });
    await h.store.put(LIMIT_KEYS.history, { peak_calls: 4, measured_at: h.clock.now });
    const id = await lease(h);
    expect(await ruleOf(await dial(h, id))).toBe("admission.limit_conflict");
    expect(await ruleOf(await dial(h, id))).toBe("admission.limit_conflict");
    const alerts = h.outbound.filter((item) => item.body.includes('"fingerprint":["ops","telnyx-guard-limit-conflict"]'));
    expect(alerts).toHaveLength(1);
  });

  it("refuses without a fresh reading of production's dial peaks", async () => {
    const h = await ready();
    const id = await lease(h);
    await h.store.delete(ADMISSION_KEYS.accountRate);
    expect(await ruleOf(await dial(h, id))).toBe("admission.account_rate_unknown");
    await h.store.put(ADMISSION_KEYS.accountRate, { peak_hour_dials: 0, peak_day_dials: 0, measured_at: h.clock.now - 37 * 3600_000 });
    expect(await ruleOf(await dial(h, id))).toBe("admission.account_rate_unknown");
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
  });

  it("counts production's peak hour and day against Telnyx's account-wide 10 an hour and 100 a day", async () => {
    const h = await ready();
    await h.store.put(ADMISSION_KEYS.reserve, { legs: 0, measured_at: h.clock.now });
    const id = await lease(h);
    // Production's peak of 8 leaves the rig 2 of the hour's 10.
    await h.store.put(ADMISSION_KEYS.accountRate, { peak_hour_dials: 8, peak_day_dials: 8, measured_at: h.clock.now });
    for (let i = 0; i < 2; i++) {
      const response = await dial(h, id);
      expect(response.status).toBe(200);
      h.telnyx.calls.set(((await response.json()) as { data: { call_control_id: string } }).data.call_control_id, { alive: false });
    }
    expect(await ruleOf(await dial(h, id))).toBe("admission.account_hour_full");
    // The hour before still counts: a rolling hour can straddle two UTC hours.
    h.advance(3600_000);
    const next = await lease(h);
    await h.store.put(ADMISSION_KEYS.accountRate, { peak_hour_dials: 8, peak_day_dials: 8, measured_at: h.clock.now });
    expect(await ruleOf(await dial(h, next))).toBe("admission.account_hour_full");

    await h.store.put(ADMISSION_KEYS.accountRate, { peak_hour_dials: 0, peak_day_dials: 98, measured_at: h.clock.now });
    expect(await ruleOf(await dial(h, next))).toBe("admission.account_day_full");
  });

  it("records a ceiling from Telnyx's concurrency refusal, and halts the paid lanes", async () => {
    const h = await ready();
    const id = await lease(h);
    expect((await dial(h, id)).status).toBe(200);
    refuseNextDial(h, 403, "90041");
    expect((await dial(h, id, { ...DIAL, to: N.devW2 })).status).toBe(403);
    // Production was idle at admission: one rig leg up plus the one refused, less one.
    expect(await h.store.get<Ceiling[]>(LIMIT_KEYS.ceiling)).toEqual([{ value: 1, from: "telnyx-90041", at: h.clock.now }]);
    expect((await limitInForce(h.ctx)).limit).toBe(1);
    expect(await ruleOf(await dial(h, id, { ...DIAL, to: N.devA1 }))).toBe("signal.halted");
    const signal = h.outbound.find((item) => item.body.includes("telnyx-concurrency-refusal"));
    expect(signal?.body).toContain('"fingerprint":["ops","telnyx-account-signal"]');
  });

  it("records a ceiling with no value when production was not seen idle", async () => {
    for (const code of ["90042", "90043"]) {
      const h = await ready();
      h.telnyx.activeCallsSupported = false;
      const id = await lease(h);
      refuseNextDial(h, 422, code);
      await dial(h, id);
      expect(await h.store.get<Ceiling[]>(LIMIT_KEYS.ceiling)).toEqual([{ value: null, from: `telnyx-${code}`, at: h.clock.now }]);
      expect(await ruleOf(await dial(h, id))).toBe("signal.halted");
    }
  });

  it("halts on a dial-rate refusal only when it comes with a 429, and records no ceiling for it", async () => {
    const h = await ready();
    const id = await lease(h);
    refuseNextDial(h, 422, "90103");
    expect((await dial(h, id)).status).toBe(422);
    expect((await dial(h, id, { ...DIAL, to: N.devW2 })).status).toBe(200);
    refuseNextDial(h, 429, "90103");
    expect((await dial(h, id, { ...DIAL, to: N.devA1 })).status).toBe(429);
    expect(await h.store.get(LIMIT_KEYS.ceiling)).toBeUndefined();
    expect(await ruleOf(await dial(h, id))).toBe("signal.halted");
    expect(h.outbound.some((item) => item.body.includes("telnyx-dial-rate-refusal"))).toBe(true);
  });

  it("records nothing for Telnyx's other refusals", async () => {
    const h = await ready();
    const id = await lease(h);
    refuseNextDial(h, 422, "10015");
    expect((await dial(h, id)).status).toBe(422);
    expect(await h.store.get(LIMIT_KEYS.ceiling)).toBeUndefined();
    expect((await dial(h, id)).status).toBe(200);
  });

  it("dials only inside the window, the measured one when fresh", async () => {
    const h = await ready({ now: Date.parse("2026-11-02T12:00:00Z") });
    const id = await lease(h);
    expect(await ruleOf(await dial(h, id))).toBe("admission.outside_window");
    await h.store.put(ADMISSION_KEYS.window, { start_hour: 9, measured_at: h.clock.now });
    expect((await dial(h, id)).status).toBe(200);
    h.advance(40 * 24 * 60 * 60 * 1000);
    await fileValidation(h);
    await h.store.put(ADMISSION_KEYS.reserve, { legs: 2, measured_at: h.clock.now });
    await h.store.put(ADMISSION_KEYS.ratios, { calls: 10, abandoned: 0, short: 0, measured_at: h.clock.now });
    const fresh = await lease(h);
    expect(await ruleOf(await dial(h, fresh))).toBe("admission.outside_window");
  });

  it("refuses on unknown, abandoned-heavy or short-heavy ratios", async () => {
    const h = await ready();
    const id = await lease(h);
    await h.store.delete(ADMISSION_KEYS.ratios);
    expect(await ruleOf(await dial(h, id))).toBe("admission.ratios_unknown");
    await h.store.put(ADMISSION_KEYS.ratios, { calls: 100, abandoned: 16, short: 0, measured_at: h.clock.now });
    expect(await ruleOf(await dial(h, id))).toBe("admission.abandoned_ratio");
    await h.store.put(ADMISSION_KEYS.ratios, { calls: 100, abandoned: 15, short: 11, measured_at: h.clock.now });
    expect(await ruleOf(await dial(h, id))).toBe("admission.short_ratio");
    await h.store.put(ADMISSION_KEYS.ratios, { calls: 100, abandoned: 15, short: 10, measured_at: h.clock.now - 37 * 3600_000 });
    expect(await ruleOf(await dial(h, id))).toBe("admission.ratios_unknown");
  });

  it("leaves no room without a fresh production reserve", async () => {
    const h = await ready();
    const id = await lease(h);
    await h.store.put(ADMISSION_KEYS.reserve, { legs: 2, measured_at: h.clock.now - 37 * 3600_000 });
    expect(await ruleOf(await dial(h, id))).toBe("admission.reserve_unknown");
  });

  it("counts live nonprod legs against the room", async () => {
    // Limit 5, reserve 3: room for two test legs.
    const h = await ready();
    await h.store.put(ADMISSION_KEYS.reserve, { legs: 3, measured_at: h.clock.now });
    const id = await lease(h);
    expect((await dial(h, id)).status).toBe(200);
    expect((await dial(h, id, { ...DIAL, to: N.devW2 })).status).toBe(200);
    expect(await ruleOf(await dial(h, id, { ...DIAL, to: N.devA1 }))).toBe("admission.no_room");
    // A leg Telnyx says has ended frees its place.
    const [first] = [...h.telnyx.calls.keys()];
    h.telnyx.calls.set(first, { alive: false });
    expect((await dial(h, id, { ...DIAL, to: N.devA1 })).status).toBe(200);
  });

  it("refuses while production has a call up", async () => {
    const h = await ready();
    const id = await lease(h);
    h.telnyx.activeCalls.set("conn-prod-voice", [{ call_control_id: "ccid-production" }]);
    expect(await ruleOf(await dial(h, id))).toBe("admission.production_call_live");
  });

  it("caps dials at 18 a day and 3 an hour", async () => {
    const h = await ready();
    await h.store.put(ADMISSION_KEYS.reserve, { legs: 0, measured_at: h.clock.now });
    const id = await lease(h);
    for (let i = 0; i < 3; i++) {
      const response = await dial(h, id);
      expect(response.status).toBe(200);
      h.telnyx.calls.set(((await response.json()) as { data: { call_control_id: string } }).data.call_control_id, {
        alive: false,
      });
    }
    expect(await ruleOf(await dial(h, id))).toBe("budget.dials_hour");
    await h.store.put("count:dials:2026-11-02", 18);
    h.advance(3600_000);
    const fresh = await lease(h);
    expect(await ruleOf(await dial(h, fresh))).toBe("budget.dials_day");
  });

  it("admits only core scenarios at amber, and nothing paid at red", async () => {
    const h = await ready();
    const core = await lease(h, "S02");
    // $35 over the 29 days left in November is about $1.21 a day.
    await charge(h.ctx, 2);
    expect((await dial(h, core)).status).toBe(200);
    await h.call(`/lease/${core}`, { caller: "robot", method: "DELETE" });
    const other = await lease(h, "S09");
    expect(await ruleOf(await dial(h, other))).toBe("budget.tier_amber");
    await charge(h.ctx, 40);
    expect(await ruleOf(await dial(h, other))).toBe("budget.tier_red");
  });

  it("refuses all test spend under the balance floor", async () => {
    const h = await ready();
    h.telnyx.balance = "99.00";
    const id = await lease(h);
    expect(await ruleOf(await dial(h, id))).toBe("budget.balance_floor");
  });

  it("refuses while an account signal has paid tests halted", async () => {
    const h = await ready();
    const id = await lease(h);
    await recordSignal(h.ctx, { signal: "Low Balance", notice_id: null, corroborated_by: "balance" });
    expect(await ruleOf(await dial(h, id))).toBe("signal.halted");
  });

  it("refuses everything Telnyx when the start-up checks find the partition unsafe", async () => {
    const h = harness({ now: MONDAY_0500 });
    seedAccount(h.telnyx);
    const voice = h.telnyx.lists.call_control_applications.find((item) => item.id === "conn-voice");
    if (voice) voice.webhook_event_url = "https://api.loonext.com/webhooks/telnyx/voice";
    expect((await runSafetyChecks(h.ctx)).state).toBe("unsafe");
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers"))).toBe("startup.unsafe");
    expect(await ruleOf(await h.call("/partition"))).toBe("startup.unsafe");
  });
});
