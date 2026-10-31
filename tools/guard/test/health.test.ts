import { HEADER } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { CRONS } from "../src/guard";
import { harness, lease, N, ready, ruleOf, type Harness } from "./support";

interface Health {
  ok: boolean;
  balance_above_floor: boolean;
  room?: number;
  telnyx: { key: string; rule?: string; safety: { state: string } };
  paid_dials: { enabled: boolean; blockers: string[]; room: number | null };
  ordering: { enabled: boolean; blockers: string[] };
  money: Record<string, unknown>;
  lease: Record<string, unknown> | null;
}

async function healthOf(h: Harness, caller: string): Promise<Health> {
  return (await (await h.call("/health", { caller })).json()) as Health;
}

describe("without the Telnyx key", () => {
  it("fails every Telnyx route closed with one clear rule", async () => {
    const h = harness({ env: { TELNYX_API_KEY: "" } });
    const routes: [string, Record<string, unknown> | undefined][] = [
      ["/telnyx/v2/phone_numbers", undefined],
      ["/telnyx/v2/calls", { connection_id: "conn-robot", from: N.robot1, to: N.devW1 }],
      ["/telnyx/v2/messages", { from: N.devW1, to: N.robot1, text: "x" }],
      ["/telnyx/v2/number_orders", { phone_numbers: [] }],
      ["/telnyx/v2/balance", undefined],
      ["/partition", undefined],
    ];
    for (const [path, body] of routes) {
      const response = await h.call(path, { caller: "rig-api", body, headers: { [HEADER.lease]: "l" } });
      expect(await ruleOf(response), path).toBe("telnyx.key_missing");
    }
    expect(h.outbound).toEqual([]);
  });

  it("says so in /health, and keeps the other vendors' routes up", async () => {
    const h = harness({ env: { TELNYX_API_KEY: "" } });
    const health = await healthOf(h, "robot");
    expect(health.ok).toBe(false);
    expect(health.balance_above_floor).toBe(false);
    expect(health.room).toBeUndefined();
    expect(health.telnyx).toMatchObject({ key: "absent", rule: "telnyx.key_missing" });
    expect(health.paid_dials.enabled).toBe(false);
    expect(health.paid_dials.blockers).toContain("telnyx.key_missing");
    expect((await h.call("/resend/emails", { body: { to: "delivered@resend.dev", subject: "s" } })).status).toBe(200);
  });

  it("runs the upkeep cron without touching Telnyx", async () => {
    const h = harness({ env: { TELNYX_API_KEY: "" } });
    await h.guard.cron(CRONS.upkeep);
    expect(h.telnyx.log).toEqual([]);
  });
});

describe("/health", () => {
  it("reports a ready partition, and why paid dials or ordering are off", async () => {
    const h = await ready({ env: { TELNYX_CONCURRENT_LIMIT: "unknown" } });
    const health = await healthOf(h, "admin");
    expect(health.ok).toBe(true);
    expect(health.telnyx.safety.state).toBe("ok");
    expect(health.paid_dials).toMatchObject({ enabled: false, room: null, window_start_hour_utc: 4, in_window: true });
    expect(health.paid_dials.blockers).toEqual(["admission.limit_unknown"]);
    expect(health.ordering).toEqual({ enabled: false, blockers: ["concurrent_limit_unknown"] });
    expect(health.money).toMatchObject({ tier: "green", balance_usd: 500, balance_floor_usd: 100 });
  });

  it("shows the room and the live lease once FA0's limit is set", async () => {
    const h = await ready();
    await lease(h, "S02");
    const health = await healthOf(h, "robot");
    expect(health).toMatchObject({ ok: true, balance_above_floor: true, room: 4 });
    expect(health.paid_dials).toMatchObject({ enabled: true, room: 4 });
    expect(health.ordering).toEqual({ enabled: true, blockers: [] });
    expect(health.lease).toMatchObject({ scenario: "S02" });
  });

  it("names production's missing capability as an ordering blocker", async () => {
    const h = await ready();
    h.production.capabilities = [];
    const health = await healthOf(h, "robot");
    expect(health.ordering.blockers).toEqual(["production_lacks_partition_rule"]);
  });
});

describe("/version", () => {
  it("answers with the deployment's version id for the attestation", async () => {
    const h = harness({ version: "8c2f5a1e-version" });
    expect(await (await h.call("/version", { caller: "diag" })).json()).toEqual({ version_id: "8c2f5a1e-version" });
  });
});
