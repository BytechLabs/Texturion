import { HEADER, LEASE_MAX_MS } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { recordSignal, requirePaidLanesOpen } from "../src/state/signals";
import { harness, lease, N, ready, registerViaEdge, ruleOf } from "./support";

describe("the run lease", () => {
  it("is one at a time across the system", async () => {
    const h = await ready();
    const first = await h.call("/lease", { caller: "robot", body: { scenario: "S02" } });
    expect(first.status).toBe(201);
    const grant = (await first.json()) as { lease_id: string; scenario: string; expires_at: string };
    expect(grant.scenario).toBe("S02");
    expect(Date.parse(grant.expires_at) - h.clock.now).toBe(LEASE_MAX_MS);
    expect(await ruleOf(await h.call("/lease", { caller: "rig-api", body: { scenario: "S01" } }))).toBe("lease.busy");
    expect(await (await h.call("/lease", { caller: "rig-api" })).json()).toMatchObject({ lease_id: grant.lease_id });
  });

  it("is free again once released, or once it has run out", async () => {
    const h = await ready();
    const id = await lease(h);
    expect((await h.call(`/lease/${id}`, { caller: "robot", method: "DELETE" })).status).toBe(200);
    expect(await ruleOf(await h.call(`/lease/${id}`, { caller: "robot", method: "DELETE" }))).toBe("lease.not_found");
    await lease(h, "S04");
    h.advance(LEASE_MAX_MS);
    expect(await (await h.call("/lease", { caller: "robot" })).json()).toBeNull();
    await lease(h, "S05");
  });

  it("refuses a scenario id that is not one", async () => {
    const h = harness();
    for (const scenario of ["", "s02", "S2", "S002", "../S02", 7]) {
      expect(await ruleOf(await h.call("/lease", { caller: "robot", body: { scenario } })), String(scenario)).toBe(
        "lease.scenario_invalid",
      );
    }
    expect((await h.call("/lease", { caller: "robot", body: { scenario: "D02p" } })).status).toBe(201);
  });

  it("starts the preemption poll", async () => {
    const h = await ready();
    await lease(h);
    expect(h.alarms).toEqual([h.clock.now + 2000]);
  });
});

describe("preemption", () => {
  it("hangs up every test leg on the first production call, and records the run as preempted", async () => {
    const h = await ready();
    const id = await lease(h);
    h.telnyx.calls.set("ccid-1", { alive: true });
    h.telnyx.calls.set("ccid-2", { alive: true });
    await registerViaEdge(h, "ccid-1");
    await registerViaEdge(h, "ccid-2", "conn-robot", "robot");

    await h.guard.alarm();
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
    expect(h.alarms).toHaveLength(2);

    h.telnyx.activeCalls.set("conn-prod-webrtc", [{ call_control_id: "ccid-production" }]);
    await h.guard.alarm();
    const hangups = h.telnyx.requests("POST", "/v2/calls").map((entry) => entry.path).sort();
    expect(hangups).toEqual(["/v2/calls/ccid-1/actions/hangup", "/v2/calls/ccid-2/actions/hangup"]);
    expect(await h.store.get<{ preempted_at?: number }>("lease")).toMatchObject({ lease_id: id, preempted_at: h.clock.now });
    expect(await (await h.call("/lease", { caller: "robot" })).json()).toBeNull();
    expect(h.alarms).toHaveLength(2);
  });

  it("stops polling only when Telnyx has no active-calls read at all", async () => {
    const h = await ready();
    await lease(h);
    h.telnyx.activeCallsSupported = false;
    await h.guard.alarm();
    expect(h.alarms).toHaveLength(1);
  });

  it("keeps polling through an active-calls read that failed for now", async () => {
    const h = await ready();
    await lease(h);
    for (const status of [503, 429]) {
      h.telnyx.failNext = { method: "GET", path: "/v2/connections/conn-prod-voice/active_calls", status };
      await h.guard.alarm();
    }
    expect(h.alarms).toHaveLength(3);
    h.telnyx.activeCalls.set("conn-prod-voice", [{ call_control_id: "ccid-production" }]);
    await h.guard.alarm();
    expect(await (await h.call("/lease", { caller: "robot" })).json()).toBeNull();
  });

  it("keeps polling when the partition cannot be refreshed", async () => {
    const h = await ready();
    await lease(h);
    h.advance(6 * 60 * 1000);
    h.telnyx.failNext = { method: "GET", path: "/v2/phone_numbers", status: 500 };
    await h.guard.alarm();
    expect(h.alarms).toHaveLength(2);
  });

  it("admits no new leg while it cannot see production's calls", async () => {
    const h = await ready();
    const id = await lease(h);
    h.telnyx.failNext = { method: "GET", path: "/v2/connections/conn-prod-webrtc/active_calls", status: 503 };
    const dial = () =>
      h.call("/telnyx/v2/calls", {
        caller: "robot",
        body: { connection_id: "conn-robot", from: N.robot1, to: N.devW1 },
        headers: { [HEADER.lease]: id },
      });
    expect(await ruleOf(await dial())).toBe("admission.production_calls_unknown");
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
    expect((await dial()).status).toBe(200);
  });

  it("tries a failed hangup again on the next poll before it calls the run preempted", async () => {
    const h = await ready();
    const id = await lease(h);
    h.telnyx.calls.set("ccid-1", { alive: true });
    await registerViaEdge(h, "ccid-1");
    h.telnyx.activeCalls.set("conn-prod-voice", [{ call_control_id: "ccid-production" }]);
    h.telnyx.failNext = { method: "POST", path: "/v2/calls/ccid-1/actions/hangup", status: 500 };
    await h.guard.alarm();
    expect(await h.store.get<{ preempted_at?: number }>("lease")).not.toHaveProperty("preempted_at");
    expect(h.alarms).toHaveLength(2);
    await h.guard.alarm();
    expect(h.telnyx.requests("POST", "/v2/calls/ccid-1/actions/hangup")).toHaveLength(2);
    expect(await h.store.get<{ preempted_at?: number }>("lease")).toMatchObject({ lease_id: id, preempted_at: h.clock.now });
  });

  it("does nothing without a live lease", async () => {
    const h = await ready();
    await h.guard.alarm();
    expect(h.telnyx.log).toEqual([]);
  });
});

describe("account signals", () => {
  const halt = (signal: string, notice_id: string | null = null) => ({
    signal,
    notice_id,
    corroborated_by: "signature" as const,
  });

  it("halt paid tests for seven days and raise a production event", async () => {
    const h = await ready();
    const response = await h.call("/halt", {
      caller: "edge",
      body: {
        signal: "Suspicious Outbound Voice Traffic",
        notice_id: "notice-1",
        corroborated_by: "signature",
        received_at: new Date(h.clock.now).toISOString(),
      },
    });
    expect(await response.json()).toMatchObject({ latched: false });
    await expect(requirePaidLanesOpen(h.ctx)).rejects.toMatchObject({ rule: "signal.halted" });
    const event = h.outbound.find((item) => item.url.includes("/envelope/"));
    expect(event?.body).toContain('"fingerprint":["ops","telnyx-account-signal"]');
    h.advance(7 * 24 * 60 * 60 * 1000);
    await expect(requirePaidLanesOpen(h.ctx)).resolves.toBeUndefined();
  });

  it("keep the paid lanes off after a second signal inside 30 days, until the design changes", async () => {
    const h = await ready();
    await recordSignal(h.ctx, halt("Abandoned calls"));
    h.advance(20 * 24 * 60 * 60 * 1000);
    await recordSignal(h.ctx, halt("Short duration calls"));
    h.advance(60 * 24 * 60 * 60 * 1000);
    await expect(requirePaidLanesOpen(h.ctx)).rejects.toMatchObject({ rule: "signal.latched" });

    // A reviewed commit changes SIGNAL_LATCH_RESET; the latch and the signals behind it clear.
    h.ctx.config.signalLatchReset = "second";
    await expect(requirePaidLanesOpen(h.ctx)).resolves.toBeUndefined();
    await recordSignal(h.ctx, halt("Low Balance"));
    await expect(requirePaidLanesOpen(h.ctx)).rejects.toMatchObject({ rule: "signal.halted" });
    h.advance(8 * 24 * 60 * 60 * 1000);
    await expect(requirePaidLanesOpen(h.ctx)).resolves.toBeUndefined();
  });

  it("do not latch for two signals 30 days apart", async () => {
    const h = await ready();
    await recordSignal(h.ctx, halt("Abandoned calls"));
    h.advance(31 * 24 * 60 * 60 * 1000);
    await recordSignal(h.ctx, halt("Abandoned calls"));
    h.advance(8 * 24 * 60 * 60 * 1000);
    await expect(requirePaidLanesOpen(h.ctx)).resolves.toBeUndefined();
  });

  it("count one notice once, however often the edge retries it", async () => {
    const h = await ready();
    await recordSignal(h.ctx, halt("Account Disabled", "notice-7"));
    await recordSignal(h.ctx, halt("Account Disabled", "notice-7"));
    h.advance(8 * 24 * 60 * 60 * 1000);
    await expect(requirePaidLanesOpen(h.ctx)).resolves.toBeUndefined();
    const events = h.outbound.filter((item) => item.body.includes("telnyx-account-signal"));
    expect(events).toHaveLength(1);
  });

  it("accept only a named, corroborated signal, and only from the edge", async () => {
    const h = await ready();
    for (const body of [
      { signal: "", corroborated_by: "balance" },
      { signal: "Low Balance", corroborated_by: "a hunch" },
      // The edge's contract names the signed notice `signature`.
      { signal: "Low Balance", corroborated_by: "notification_event" },
      { signal: "Low Balance" },
    ]) {
      expect(await ruleOf(await h.call("/halt", { caller: "edge", body })), JSON.stringify(body)).toBe(
        "request.body_invalid",
      );
    }
    expect(
      await ruleOf(await h.call("/halt", { caller: "admin", body: { signal: "Low Balance", corroborated_by: "balance" } })),
    ).toBe("class.not_allowed");
  });
});

describe("the lease's activity record", () => {
  const DIAL = { connection_id: "conn-robot", from: N.robot1, to: N.devW1, timeout_secs: 30 };
  const activityOf = async (h: Awaited<ReturnType<typeof ready>>, id: string) =>
    (await (await h.call(`/lease/${id}/activity`, { caller: "robot" })).json()) as {
      live: boolean;
      activity: Record<string, number>;
    };

  it("counts each Telnyx request by caller, endpoint and outcome, refusals included", async () => {
    const h = await ready();
    const id = await lease(h);
    expect(await activityOf(h, id)).toMatchObject({ live: true, activity: {} });
    await h.call("/telnyx/v2/calls", { caller: "robot", body: DIAL, headers: { [HEADER.lease]: id } });
    await h.call("/telnyx/v2/calls", { caller: "robot", body: { ...DIAL, to: N.notOwned }, headers: { [HEADER.lease]: id } });
    await h.call("/telnyx/v2/calls", { caller: "robot", body: { ...DIAL, to: N.notOwned }, headers: { [HEADER.lease]: id } });
    expect((await activityOf(h, id)).activity).toEqual({
      "robot POST /v2/calls 200": 1,
      "robot POST /v2/calls dial.to_not_owned": 2,
    });
  });

  it("is kept after release, counts nothing while no lease is live, and names only the last lease", async () => {
    const h = await ready();
    const id = await lease(h);
    await h.call("/telnyx/v2/calls", { caller: "robot", body: DIAL, headers: { [HEADER.lease]: id } });
    await h.call(`/lease/${id}`, { caller: "robot", method: "DELETE" });
    await h.call("/telnyx/v2/calls", { caller: "robot", body: DIAL, headers: { [HEADER.lease]: id } });
    expect(await activityOf(h, id)).toMatchObject({ live: false, activity: { "robot POST /v2/calls 200": 1 } });
    await lease(h, "S04");
    expect(await ruleOf(await h.call(`/lease/${id}/activity`, { caller: "robot" }))).toBe("lease.not_found");
  });
});
