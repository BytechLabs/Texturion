import { HEADER, LEASE_MAX_MS } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { recordSignal } from "../src/state/signals";
import { harness, lease, N, ready, ruleOf } from "./support";

describe("the run lease", () => {
  it("is one at a time across the system", async () => {
    const h = await ready();
    const first = await h.call("/lease", { caller: "robot", body: { scenario: "S02" } });
    expect(first.status).toBe(201);
    const grant = await first.json<{ lease_id: string; scenario: string; expires_at: string }>();
    expect(grant.scenario).toBe("S02");
    expect(Date.parse(grant.expires_at) - h.clock.now).toBe(LEASE_MAX_MS);
    await expect(ruleOf(await h.call("/lease", { caller: "rig-api", body: { scenario: "S01" } }))).resolves.toBe("lease.busy");
    await expect((await h.call("/lease", { caller: "rig-api" })).json()).resolves.toMatchObject({ lease_id: grant.lease_id });
  });

  it("is free again once released, or once it has run out", async () => {
    const h = await ready();
    const id = await lease(h);
    expect((await h.call(`/lease/${id}`, { caller: "robot", method: "DELETE" })).status).toBe(200);
    await expect(ruleOf(await h.call(`/lease/${id}`, { caller: "robot", method: "DELETE" }))).resolves.toBe("lease.not_found");
    await lease(h, "S04");
    h.advance(LEASE_MAX_MS);
    await expect((await h.call("/lease", { caller: "robot" })).json()).resolves.toBeNull();
    await lease(h, "S05");
  });

  it("refuses a scenario id that is not one", async () => {
    const h = harness();
    for (const scenario of ["", "s02", "S2", "S002", "../S02", 7]) {
      await expect(ruleOf(await h.call("/lease", { caller: "robot", body: { scenario } }))).resolves.toBe(
        "lease.scenario_invalid",
      );
    }
    expect((await h.call("/lease", { caller: "robot", body: { scenario: "D02p" } })).status).toBe(201);
  });

});

describe("account signals", () => {
  const halt = (signal: string, notice_id: string | null = null) => ({
    signal,
    notice_id,
    corroborated_by: "signature" as const,
  });

  it("report a corroborated notice to production monitoring", async () => {
    const h = await ready();
    const response = await h.call("/halt", {
      caller: "edge",
      body: {
        signal: "Abandoned calls",
        notice_id: "notice-1",
        corroborated_by: "signature",
        received_at: new Date(h.clock.now).toISOString(),
      },
    });
    await expect(response.json()).resolves.toMatchObject({ recorded: 1 });
    const event = h.outbound.find((item) => item.url.includes("posthog.com"));
    expect(event?.body).toContain('"$exception_fingerprint":"ops:telnyx-account-signal"');
  });

  it("count one notice once, however often the edge retries it", async () => {
    const h = await ready();
    await recordSignal(h.ctx, halt("Low Balance", "notice-7"));
    await recordSignal(h.ctx, halt("Low Balance", "notice-7"));
    h.advance(8 * 24 * 60 * 60 * 1000);
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
      await expect(ruleOf(await h.call("/halt", { caller: "edge", body }))).resolves.toBe(
        "request.body_invalid",
      );
    }
    await expect(ruleOf(await h.call("/halt", { caller: "admin", body: { signal: "Low Balance", corroborated_by: "balance" } }))).resolves.toBe("class.not_allowed");
  });
});

describe("the lease's activity record", () => {
  const DIAL = { connection_id: "conn-robot", from: N.robot1, to: N.devW1, timeout_secs: 30 };
  const activityOf = async (h: Awaited<ReturnType<typeof ready>>, id: string) =>
    (await h.call(`/lease/${id}/activity`, { caller: "robot" })).json<{
      live: boolean;
      activity: Record<string, number>;
    }>();

  it("counts each Telnyx request by caller, endpoint and outcome, refusals included", async () => {
    const h = await ready();
    const id = await lease(h);
    await expect(activityOf(h, id)).resolves.toMatchObject({ live: true, activity: {} });
    await h.call("/telnyx/v2/calls", { caller: "robot", body: DIAL, headers: { [HEADER.lease]: id } });
    await h.call("/telnyx/v2/calls", { caller: "robot", body: { ...DIAL, to: N.notOwned }, headers: { [HEADER.lease]: id } });
    await h.call("/telnyx/v2/calls", { caller: "robot", body: { ...DIAL, to: N.notOwned }, headers: { [HEADER.lease]: id } });
    expect((await activityOf(h, id)).activity).toEqual({
      "robot POST /v2/calls 200": 1,
      "robot POST /v2/calls dial.to_not_owned": 2,
    });
  });

  it("answers a dial or a refusal as it was when the count cannot be written", async () => {
    const h = await ready();
    const id = await lease(h);
    const put = h.store.put.bind(h.store);
    h.store.put = async (key, value) => {
      if (key === "lease") throw new Error("storage unavailable");
      return put(key, value);
    };
    const placed = await h.call("/telnyx/v2/calls", { caller: "robot", body: DIAL, headers: { [HEADER.lease]: id } });
    expect(placed.status).toBe(200);
    expect(h.telnyx.requests("POST", "/v2/calls")).toHaveLength(1);
    const refused = await h.call("/telnyx/v2/calls", { caller: "robot", body: { ...DIAL, to: N.notOwned }, headers: { [HEADER.lease]: id } });
    await expect(ruleOf(refused)).resolves.toBe("dial.to_not_owned");
  });

  it("is kept after release, counts nothing while no lease is live, and names only the last lease", async () => {
    const h = await ready();
    const id = await lease(h);
    await h.call("/telnyx/v2/calls", { caller: "robot", body: DIAL, headers: { [HEADER.lease]: id } });
    await h.call(`/lease/${id}`, { caller: "robot", method: "DELETE" });
    await h.call("/telnyx/v2/calls", { caller: "robot", body: DIAL, headers: { [HEADER.lease]: id } });
    await expect(activityOf(h, id)).resolves.toMatchObject({ live: false, activity: { "robot POST /v2/calls 200": 1 } });
    await lease(h, "S04");
    await expect(ruleOf(await h.call(`/lease/${id}/activity`, { caller: "robot" }))).resolves.toBe("lease.not_found");
  });
});
