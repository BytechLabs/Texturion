import { HEADER } from '@loonext/rig-protocol';
import type { GuardHealth } from '@loonext/rig-protocol';
import { describe, expect, it } from "vitest";

import { CRONS } from "../src/guard";
import { harness, lease, N, ready, ruleOf } from './support';
import type { Harness } from './support';

/** The protocol's fields, and the guard-only detail these cases read. */
type Health = GuardHealth & {
  ordering: { enabled: boolean; blockers: string[]; stopped_reason?: string };
  lease: Record<string, unknown> | null;
};

async function healthOf(h: Harness, caller: string): Promise<Health> {
  return (await h.call("/health", { caller })).json<Health>();
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
      await expect(ruleOf(response)).resolves.toBe("telnyx.key_missing");
    }
    expect(h.outbound).toEqual([]);
  });

  it("says so in /health, and keeps the other vendors' routes up", async () => {
    const h = harness({ env: { TELNYX_API_KEY: "" } });
    const health = await healthOf(h, "robot");
    expect(health.ok).toBe(false);
    expect(health.telnyx).toMatchObject({ key: "absent", rule: "telnyx.key_missing" });
    expect((await h.call("/resend/emails", { body: { to: "delivered@resend.dev", subject: "s" } })).status).toBe(200);
  });

  it("runs the upkeep cron without touching Telnyx", async () => {
    const h = harness({ env: { TELNYX_API_KEY: "" } });
    await h.guard.cron(CRONS.upkeep);
    expect(h.telnyx.log).toEqual([]);
  });
});

describe("/health", () => {
  it("reports a ready partition and the live lease without reading vendor account balance", async () => {
    const h = await ready();
    await lease(h, "S02");
    const health = await healthOf(h, "robot");
    expect(health.ok).toBe(true);
    expect(health.telnyx.safety.state).toBe("ok");
    expect(health.ordering).toEqual({ enabled: true, blockers: [] });
    expect(health.lease).toMatchObject({ scenario: "S02" });
    expect(h.telnyx.requests("GET", "/v2/balance")).toEqual([]);
  });

  it("names production's missing capability as an ordering blocker", async () => {
    const h = await ready();
    h.production.capabilities = [];
    const health = await healthOf(h, "robot");
    expect(health.ordering.blockers).toEqual(["production_lacks_partition_rule"]);
  });
});

describe("/health after ordering stopped", () => {
  it("names the reason code the read-back stopped for", async () => {
    const h = await ready();
    await h.store.put("orders:stopped", { at: h.clock.now, reason: "number_unreadable" });
    const health = await healthOf(h, "robot");
    expect(health.ordering.blockers).toEqual(["stopped_after_group_check"]);
    expect(health.ordering.stopped_reason).toBe("number_unreadable");
  });
});

describe("/version", () => {
  it("answers with the deployment's version id for the attestation", async () => {
    const h = harness({ version: "8c2f5a1e-version" });
    await expect((await h.call("/version", { caller: "diag" })).json()).resolves.toEqual({ version_id: "8c2f5a1e-version" });
  });
});
