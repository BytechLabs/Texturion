import { describe, expect, it } from "vitest";

import { assess, isProductionHost, runSafetyChecks, SAFETY_KEY, type Listings } from "../src/setup/safety";
import { readConfig, type Env } from "../src/env";
import { EDGE, FULL_ENV, harness, PROD_WEBHOOK, ready, ruleOf, seedAccount } from "./support";
import { FakeTelnyx } from "./fake-telnyx";

function listings(mutate: (telnyx: FakeTelnyx) => void = () => {}): Listings {
  const telnyx = new FakeTelnyx();
  seedAccount(telnyx);
  mutate(telnyx);
  const numbers = telnyx.numbers;
  return {
    billingGroups: telnyx.lists.billing_groups,
    outboundVoiceProfiles: telnyx.lists.outbound_voice_profiles,
    apps: telnyx.lists.call_control_applications,
    credentialConnections: telnyx.lists.credential_connections,
    messagingProfiles: telnyx.lists.messaging_profiles,
    productionNumbers: numbers.filter((item) => !item.billing_group_id),
    nonprodNumbers: numbers.filter((item) => item.billing_group_id === "bg-nonprod"),
  };
}

const ctx = { config: readConfig(FULL_ENV as Env), now: () => 0 };

describe("start-up checks", () => {
  it("pass on a clean partition beside production", () => {
    const result = assess(ctx, listings(), []);
    expect(result.reasons).toEqual([]);
    expect(result.record?.connections).toEqual({
      voice: "conn-voice",
      robot: "conn-robot",
      webrtc: "conn-webrtc",
      sentinel: "conn-sentinel",
    });
    expect(result.record?.production.connection_ids).toEqual(["conn-prod-voice", "conn-prod-webrtc"]);
    expect(result.record?.production.messaging_profile_ids).toEqual(["prof-prod"]);
  });

  it("refuse a nonprod resource pointed at loonext.com", () => {
    const result = assess(
      ctx,
      listings((telnyx) => {
        const profile = telnyx.lists.messaging_profiles.find((item) => item.id === "prof-qa-w");
        if (profile) profile.webhook_failover_url = "https://api.loonext.com/webhooks/telnyx";
      }),
      [],
    );
    expect(result.reasons).toContain("points_at_production:messaging_profile:nonprod-qa-w");
  });

  it("refuse a nonprod id that is also production's", () => {
    const result = assess(
      ctx,
      listings((telnyx) => {
        const number = telnyx.numbers.find((item) => item.id === "num-prod");
        if (number) number.connection_id = "conn-voice";
      }),
      [],
    );
    expect(result.reasons).toContain("id_overlap:connection");
    const profile = assess(
      ctx,
      listings((telnyx) => {
        const number = telnyx.numbers.find((item) => item.id === "num-prod");
        if (number) number.messaging_profile_id = "prof-qa-w";
      }),
      [],
    );
    expect(profile.reasons).toContain("id_overlap:messaging_profile");
  });

  it("pass, and find the same production resources, when Telnyx ignores the group filter", async () => {
    const h = harness();
    seedAccount(h.telnyx);
    h.telnyx.ignoreFilters = true;
    const safety = await runSafetyChecks(h.ctx);
    expect(safety).toMatchObject({ state: "ok", reasons: [] });
    expect((await h.store.get<{ production: unknown }>("partition"))?.production).toEqual({
      connection_ids: ["conn-prod-voice", "conn-prod-webrtc"],
      messaging_profile_ids: ["prof-prod"],
    });
  });

  it("refuse a nonprod number bound to production's connection or profile", () => {
    const onConnection = assess(
      ctx,
      listings((telnyx) => {
        const number = telnyx.numbers.find((item) => item.id === "num-devw1");
        if (number) number.connection_id = "conn-prod-voice";
      }),
      [],
    );
    expect(onConnection.reasons).toContain("number_on_production_resource:1");
    const onProfile = assess(
      ctx,
      listings((telnyx) => {
        const number = telnyx.numbers.find((item) => item.id === "num-devw2");
        if (number) number.messaging_profile_id = "prof-prod";
      }),
      [],
    );
    expect(onProfile.reasons).toContain("number_on_production_resource:1");
  });

  it("refuse a credential connection that could call a phone number", () => {
    const result = assess(
      ctx,
      listings((telnyx) => {
        const connection = telnyx.lists.credential_connections.find((item) => item.id === "conn-webrtc");
        if (connection) connection.outbound = { outbound_voice_profile_id: "ovp-voice" };
      }),
      [],
    );
    expect(result.reasons).toContain("credential_connection_has_ovp:nonprod-webrtc");
  });

  it("refuse a limit-probe profile any connection uses, or two profiles with its name", async () => {
    expect(assess(ctx, listings(), []).reasons).not.toContain("limit_probe_ovp_in_use");
    const uses = (id: string) =>
      listings((telnyx) => {
        const item = [...telnyx.lists.call_control_applications, ...telnyx.lists.credential_connections].find((entry) => entry.id === id);
        if (item) item.outbound = { outbound_voice_profile_id: "ovp-probe" };
      });
    for (const id of ["conn-prod-voice", "conn-voice", "conn-robot", "conn-prod-webrtc"]) {
      expect(assess(ctx, uses(id), []).reasons, id).toContain("limit_probe_ovp_in_use");
    }
    const twice = listings((telnyx) => telnyx.lists.outbound_voice_profiles.push({ id: "ovp-probe-2", name: "nonprod-limit-probe-ovp" }));
    expect(assess(ctx, twice, []).reasons).toContain("limit_probe_ovp_in_use");

    const h = harness();
    seedAccount(h.telnyx);
    const app = h.telnyx.lists.call_control_applications.find((item) => item.id === "conn-prod-voice");
    if (app) app.outbound = { outbound_voice_profile_id: "ovp-probe" };
    expect((await runSafetyChecks(h.ctx)).state).toBe("unsafe");
  });

  it("refuse a nonprod webhook that is not the edge, and two resources with one name", () => {
    const result = assess(
      ctx,
      listings((telnyx) => {
        const app = telnyx.lists.call_control_applications.find((item) => item.id === "conn-robot");
        if (app) app.webhook_event_url = "https://somewhere.example/t/r";
        telnyx.lists.credential_connections.push({ id: "conn-dup", connection_name: "nonprod-webrtc" });
      }),
      [],
    );
    expect(result.reasons).toContain("webhook_not_edge:app:nonprod-robot");
    expect(result.reasons).toContain("duplicate_name:nonprod-webrtc");
  });

  it("count an app-created profile on the edge as nonprod, and check it too", () => {
    const result = assess(
      ctx,
      listings((telnyx) => {
        telnyx.lists.messaging_profiles.push({ id: "prof-app", name: "company-uuid", webhook_url: `${EDGE}/t/m` });
      }),
      [],
    );
    expect(result.extraProfiles).toEqual(["prof-app"]);
    expect(result.reasons).toEqual([]);
  });

  it("report a partition that does not exist yet as unconfigured, not unsafe", async () => {
    const h = harness();
    const safety = await runSafetyChecks(h.ctx);
    expect(safety.state).toBe("unconfigured");
    expect(safety.reasons).toContain("billing_group_missing");
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers"))).toBe("startup.unconfigured");
  });

  it("refuse without an edge origin", async () => {
    const h = harness({ env: { EDGE_ORIGIN: "" } });
    seedAccount(h.telnyx);
    const safety = await runSafetyChecks(h.ctx);
    expect(safety.state).toBe("unsafe");
    expect(safety.reasons).toContain("edge_origin_unset");
  });

  it("run again on a new deployment and after six hours", async () => {
    const h = await ready();
    const checks = () => h.telnyx.requests("GET", "/v2/call_control_applications").length;
    await h.call("/telnyx/v2/phone_numbers");
    expect(checks()).toBe(0);
    h.advance(6 * 3600_000 + 1);
    await h.call("/telnyx/v2/phone_numbers");
    expect(checks()).toBe(1);

    const voice = h.telnyx.lists.call_control_applications.find((item) => item.id === "conn-voice");
    if (voice) voice.webhook_event_url = PROD_WEBHOOK;
    h.ctx.versionId = "version-2";
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers"))).toBe("startup.unsafe");
    expect((await h.store.get<{ version: string }>(SAFETY_KEY))?.version).toBe("version-2");
  });

  it("stop Resend, FCM and AI too once the partition is known unsafe", async () => {
    const h = harness();
    seedAccount(h.telnyx);
    const voice = h.telnyx.lists.call_control_applications.find((item) => item.id === "conn-voice");
    if (voice) voice.webhook_event_url = PROD_WEBHOOK;
    await runSafetyChecks(h.ctx);
    expect(await ruleOf(await h.call("/resend/emails", { body: { to: "delivered@resend.dev" } }))).toBe("startup.unsafe");
    expect(await ruleOf(await h.call("/ai/run/x", { body: {} }))).toBe("startup.unsafe");
  });

  it("recognise production by its domain", () => {
    expect(isProductionHost("https://api.loonext.com/webhooks/telnyx")).toBe(true);
    expect(isProductionHost("https://loonext.com/x")).toBe(true);
    expect(isProductionHost("https://app.loonext.com")).toBe(true);
    expect(isProductionHost(`${EDGE}/t/v`)).toBe(false);
    expect(isProductionHost("https://loonext.com.example")).toBe(false);
    expect(isProductionHost("https://notloonext.com")).toBe(false);
    expect(isProductionHost(null)).toBe(false);
  });
});
