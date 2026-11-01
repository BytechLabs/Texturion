import { readFileSync } from "node:fs";

import { EDGE_PATHS } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { edgeUrl, SPEC, WEBHOOK_PATHS } from "../src/setup/spec";
import { vendorLimits } from "../src/setup/setup";
import { EDGE, fileMeasurements, fileValidation, harness, ruleOf, type Harness } from "./support";

async function setup(h: Harness) {
  const response = await h.call("/admin/setup", { caller: "admin", method: "POST" });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    steps: { resource: string; name: string; action: string; reason?: string }[];
    safety: { state: string; reasons: string[] };
  };
}

function seedNotifications(h: Harness) {
  h.telnyx.lists.notification_event_conditions.push(
    ...SPEC.notifications.event_conditions.map((name, i) => ({ id: `cond-${i}`, name: `${name} notification` })),
  );
}

describe("the setup routine", () => {
  it("creates the whole partition from the spec, and leaves it safe", async () => {
    const h = harness();
    seedNotifications(h);
    const report = await setup(h);
    expect(report.safety).toMatchObject({ state: "ok", reasons: [] });

    expect(h.telnyx.lists.billing_groups.map((item) => item.name)).toEqual(["loonext-nonprod"]);
    expect(h.telnyx.lists.outbound_voice_profiles.map((item) => item.name)).toEqual([
      "nonprod-voice-ovp",
      "nonprod-robot-ovp",
      "nonprod-limit-probe-ovp",
    ]);
    expect(h.telnyx.lists.call_control_applications.map((item) => item.application_name)).toEqual([
      "nonprod-voice",
      "nonprod-robot",
    ]);
    expect(h.telnyx.lists.credential_connections.map((item) => item.connection_name)).toEqual([
      "nonprod-webrtc",
      "nonprod-sentinel",
    ]);
    expect(h.telnyx.lists.messaging_profiles).toHaveLength(5);
    expect(h.telnyx.lists.telephony_credentials).toHaveLength(1);
    expect(h.telnyx.lists.notification_settings).toHaveLength(SPEC.notifications.event_conditions.length);
    expect(h.telnyx.lists.notification_channels[0]?.channel_destination).toBe(`${EDGE}/t/n/notice-path`);
  });

  it("writes the spec's limits and webhooks", async () => {
    const h = harness();
    await setup(h);
    const voice = h.telnyx.lists.outbound_voice_profiles.find((item) => item.name === "nonprod-voice-ovp");
    expect(voice).toMatchObject({
      daily_spend_limit: "0.40",
      daily_spend_limit_enabled: true,
      whitelisted_destinations: ["US", "CA"],
      max_destination_rate: 0.01,
      calling_window: { start_time: "04:00:00.00Z", end_time: "10:00:00.00Z", calls_per_cld: 20 },
    });
    // No reserve filed yet, so the room is unknown and the vendor limit is the floor.
    expect(voice?.concurrent_call_limit).toBe(1);
    const robot = h.telnyx.lists.outbound_voice_profiles.find((item) => item.name === "nonprod-robot-ovp");
    expect(robot).toMatchObject({ daily_spend_limit: "0.20", concurrent_call_limit: 1 });

    const app = h.telnyx.lists.call_control_applications.find((item) => item.application_name === "nonprod-voice");
    expect(app).toMatchObject({
      webhook_event_url: `${EDGE}/t/v`,
      webhook_event_failover_url: `${EDGE}/t/v2`,
      webhook_timeout_secs: 10,
    });
    const webrtc = h.telnyx.lists.credential_connections.find((item) => item.connection_name === "nonprod-webrtc");
    expect(webrtc).toMatchObject({ sip_uri_calling_preference: "internal", webhook_event_url: `${EDGE}/t/w` });
    expect((webrtc?.outbound as Record<string, unknown> | undefined)?.outbound_voice_profile_id).toBeUndefined();

    // The robot's profile reports to the robot's path, as its app does; the tenants' to the app's.
    const hooks = Object.fromEntries(
      h.telnyx.lists.messaging_profiles.map((item) => [item.name, [item.webhook_url, item.webhook_failover_url]]),
    );
    expect(hooks).toEqual({
      "nonprod-robot": [`${EDGE}/t/r`, `${EDGE}/t/r`],
      "nonprod-qa-w": [`${EDGE}/t/m`, `${EDGE}/t/m`],
      "nonprod-qa-a": [`${EDGE}/t/m`, `${EDGE}/t/m`],
      "nonprod-qa-c": [`${EDGE}/t/m`, `${EDGE}/t/m`],
      "nonprod-qa-e": [`${EDGE}/t/m`, `${EDGE}/t/m`],
    });

    const total = h.telnyx.lists.messaging_profiles.reduce((sum, item) => sum + Number(item.daily_spend_limit), 0);
    // $0.40 + $0.20 + $0.06 + 4 x $0.03: the vendor-enforced $0.78 a day (docs/RIG.md).
    expect(total + 0.4 + 0.2).toBeCloseTo(0.78);
  });

  it("makes the limit-probe profile attached to nothing, spending nothing, at a limit of 1", async () => {
    const h = harness();
    const report = await setup(h);
    const probe = h.telnyx.lists.outbound_voice_profiles.find((item) => item.name === "nonprod-limit-probe-ovp");
    expect(probe).toMatchObject({
      concurrent_call_limit: 1,
      daily_spend_limit: "0.00",
      daily_spend_limit_enabled: true,
      whitelisted_destinations: [],
      billing_group_id: h.telnyx.lists.billing_groups[0]?.id,
    });
    const attached = [...h.telnyx.lists.call_control_applications, ...h.telnyx.lists.credential_connections].filter(
      (item) => (item.outbound as Record<string, unknown> | undefined)?.outbound_voice_profile_id === probe?.id,
    );
    expect(attached).toEqual([]);
    expect(report.steps.find((step) => step.name === "nonprod-limit-probe-ovp")).toMatchObject({ action: "created" });

    // A probe that ran and was cut off is put back to 1 by the next setup.
    if (probe) probe.concurrent_call_limit = 9999;
    await setup(h);
    expect(probe?.concurrent_call_limit).toBe(1);
  });

  it("reports a limit-probe profile it cannot write, without failing the rest of the setup", async () => {
    const h = harness();
    h.telnyx.lists.outbound_voice_profiles.push({ id: "ovp-probe", name: "nonprod-limit-probe-ovp" });
    h.telnyx.failNext = { method: "PATCH", path: "/v2/outbound_voice_profiles/ovp-probe", status: 500 };
    const report = await setup(h);
    expect(report.steps.find((step) => step.name === "nonprod-limit-probe-ovp")).toEqual({
      resource: "limit_probe_profile",
      name: "nonprod-limit-probe-ovp",
      action: "skipped",
      reason: "Telnyx answered 500",
    });
    expect(report.safety.state).toBe("ok");
  });

  it("turns on Telnyx's call-cost webhooks on both Call Control apps", async () => {
    const h = harness();
    await setup(h);
    const apps = h.telnyx.lists.call_control_applications.map((item) => [item.application_name, item.call_cost_in_webhooks]);
    expect(apps).toEqual([
      ["nonprod-voice", true],
      ["nonprod-robot", true],
    ]);
    expect(SPEC.call_control_applications.every((item) => item.call_cost_in_webhooks === true)).toBe(true);
  });

  it("is idempotent by name: a second run creates nothing", async () => {
    const h = harness();
    seedNotifications(h);
    await setup(h);
    const creates = h.telnyx.requests("POST").length;
    const report = await setup(h);
    expect(h.telnyx.requests("POST").length).toBe(creates);
    expect(report.steps.filter((step) => step.action === "created")).toEqual([]);
  });

  it("writes the floor's limits of 1 and 1 while only the floor is proven", async () => {
    const h = harness();
    await fileMeasurements(h, 0);
    await setup(h);
    const voice = h.telnyx.lists.outbound_voice_profiles.find((item) => item.name === "nonprod-voice-ovp");
    const app = h.telnyx.lists.call_control_applications.find((item) => item.application_name === "nonprod-voice");
    expect(voice?.concurrent_call_limit).toBe(1);
    expect(app?.outbound).toMatchObject({ channel_limit: 1 });
  });

  it("sizes the voice limits from the room once the limit is proven and production's reserve is filed", async () => {
    const h = harness();
    await fileMeasurements(h, 2);
    await fileValidation(h);
    await setup(h);
    const voice = h.telnyx.lists.outbound_voice_profiles.find((item) => item.name === "nonprod-voice-ovp");
    const app = h.telnyx.lists.call_control_applications.find((item) => item.application_name === "nonprod-voice");
    // Limit 5, reserve 2: room 3, one of it the robot's.
    expect(voice?.concurrent_call_limit).toBe(2);
    expect(app?.outbound).toMatchObject({ channel_limit: 3 });
  });

  it("never writes a null concurrent limit, which Telnyx reads as unlimited", () => {
    for (const room of [null, 0, 1, 2, 5]) {
      const limits = vendorLimits(room);
      expect(limits.voiceOvp).toBeGreaterThanOrEqual(1);
      expect(limits.voiceApp).toBeGreaterThanOrEqual(1);
    }
  });

  it("skips the notification channel without its secret path, and says so", async () => {
    const h = harness({ env: { NOTIFICATION_PATH_SECRET: "" } });
    const report = await setup(h);
    expect(report.steps.find((step) => step.resource === "notifications")).toMatchObject({ action: "skipped" });
  });

  it("refuses without the Telnyx key or the edge origin", async () => {
    expect(await ruleOf(await harness({ env: { TELNYX_API_KEY: "" } }).call("/admin/setup", { caller: "admin", method: "POST" }))).toBe(
      "telnyx.key_missing",
    );
    expect(await ruleOf(await harness({ env: { EDGE_ORIGIN: "" } }).call("/admin/setup", { caller: "admin", method: "POST" }))).toBe(
      "startup.unconfigured",
    );
  });
});

describe("the committed spec", () => {
  it("holds names and values only, never an id or a number", () => {
    const text = readFileSync(new URL("../telnyx-spec.json", import.meta.url), "utf8");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/\d{7,}/);
    expect(text).not.toMatch(/\+\d/);
    expect(text).not.toMatch(/workers\.dev|https?:\/\//);
  });

  it("names the eight standing numbers and the six-profile cap the design sets", () => {
    expect(SPEC.numbers.standing.map((item) => item.role)).toEqual([
      "ROBOT-1",
      "ROBOT-2",
      "STRANGER-1",
      "DEV-W1",
      "DEV-W2",
      "DEV-A1",
      "DEV-C1",
      "DEV-E1",
    ]);
    expect(SPEC.messaging_profiles.max_profiles).toBe(6);
    const keys = new Set(SPEC.messaging_profiles.profiles.map((item) => item.key));
    for (const item of SPEC.numbers.standing) expect(keys.has(item.messaging_profile), item.role).toBe(true);
  });

  it("names the text lanes' three standing roles, so ordering can start before paid dials", () => {
    const texts = SPEC.numbers.standing.filter((item) => item.lanes.includes("texts")).map((item) => item.role);
    expect(texts).toEqual(["ROBOT-1", "DEV-W1", "DEV-E1"]);
    for (const item of SPEC.numbers.standing) {
      expect(item.lanes, item.role).toEqual(texts.includes(item.role) ? ["texts"] : ["calls"]);
    }
  });

  it("names every webhook by an edge path the protocol has", () => {
    const named = [
      ...SPEC.call_control_applications.flatMap((item) => [item.webhook, ...(item.failover ? [item.failover] : [])]),
      ...SPEC.credential_connections.map((item) => item.webhook),
      ...SPEC.messaging_profiles.profiles.map((item) => item.webhook),
    ];
    expect(named.length).toBe(10);
    for (const path of named) {
      expect(WEBHOOK_PATHS, path).toContain(path);
      expect(edgeUrl(EDGE, path)).toBe(`${EDGE}${EDGE_PATHS[path]}`);
    }
    expect(() => edgeUrl(EDGE, "ctlRpc" as never)).toThrow();
  });
});
