import { readFileSync } from "node:fs";

import { EDGE_PATHS } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { edgeUrl, SPEC, WEBHOOK_PATHS } from "../src/setup/spec";
import { EDGE, harness, ruleOf } from './support';
import type { Harness } from './support';

async function setup(h: Harness) {
  const response = await h.call("/admin/setup", { caller: "admin", method: "POST" });
  expect(response.status).toBe(200);
  return response.json<{
    steps: { resource: string; name: string; action: string; reason?: string }[];
    safety: { state: string; reasons: string[] };
  }>();
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
    ]);
    expect(h.telnyx.lists.call_control_applications.map((item) => item.application_name)).toEqual([
      "nonprod-voice",
      "nonprod-robot",
    ]);
    expect(h.telnyx.lists.credential_connections.map((item) => item.connection_name)).toEqual([
      "nonprod-webrtc",
      "nonprod-sentinel",
    ]);
    expect(h.telnyx.lists.messaging_profiles).toHaveLength(6);
    expect(h.telnyx.lists.telephony_credentials).toHaveLength(1);
    expect(h.telnyx.lists.notification_settings).toHaveLength(SPEC.notifications.event_conditions.length);
    expect(h.telnyx.lists.notification_channels[0]?.channel_destination).toBe(`${EDGE}/t/n/notice-path`);
  });

  it("sets the destination and webhook rules without imposing spend or call caps", async () => {
    const h = harness();
    await setup(h);
    const voice = h.telnyx.lists.outbound_voice_profiles.find((item) => item.name === "nonprod-voice-ovp");
    expect(voice).toMatchObject({
      daily_spend_limit_enabled: false,
      whitelisted_destinations: ["US", "CA"],
      max_destination_rate: null,
      calling_window: null,
      concurrent_call_limit: null,
    });
    const robot = h.telnyx.lists.outbound_voice_profiles.find((item) => item.name === "nonprod-robot-ovp");
    expect(robot).toMatchObject({ daily_spend_limit_enabled: false, concurrent_call_limit: null });

    const app = h.telnyx.lists.call_control_applications.find((item) => item.application_name === "nonprod-voice");
    expect(app).toMatchObject({
      webhook_event_url: `${EDGE}/t/v`,
      webhook_event_failover_url: `${EDGE}/t/v2`,
      webhook_timeout_secs: 10,
      inbound: { channel_limit: null },
      outbound: { channel_limit: null },
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
      "nonprod-qa-g": [`${EDGE}/t/m`, `${EDGE}/t/m`],
    });

    expect(h.telnyx.lists.messaging_profiles.every((profile) => profile.daily_spend_limit_enabled === false)).toBe(true);
  });

  it("turns on Telnyx's call-cost webhooks on both Call Control apps", async () => {
    const h = harness();
    await setup(h);
    const apps = h.telnyx.lists.call_control_applications.map((item) => [item.application_name, item.call_cost_in_webhooks]);
    expect(apps).toEqual([
      ["nonprod-voice", true],
      ["nonprod-robot", true],
    ]);
    expect(SPEC.call_control_applications.every((item) =>  item.call_cost_in_webhooks)).toBe(true);
  });

  it("is idempotent by name: a second run creates nothing", async () => {
    const h = harness();
    seedNotifications(h);
    await setup(h);
    const creates = h.telnyx.requests("POST").length;
    const report = await setup(h);
    expect(h.telnyx.requests("POST")).toHaveLength(creates);
    expect(report.steps.filter((step) => step.action === "created")).toEqual([]);
  });

  it("skips the notification channel without its secret path, and says so", async () => {
    const h = harness({ env: { NOTIFICATION_PATH_SECRET: "" } });
    const report = await setup(h);
    expect(report.steps.find((step) => step.resource === "notifications")).toMatchObject({ action: "skipped" });
  });

  it("refuses without the Telnyx key or the edge origin", async () => {
    await expect(ruleOf(await harness({ env: { TELNYX_API_KEY: "" } }).call("/admin/setup", { caller: "admin", method: "POST" }))).resolves.toBe(
      "telnyx.key_missing",
    );
    await expect(ruleOf(await harness({ env: { EDGE_ORIGIN: "" } }).call("/admin/setup", { caller: "admin", method: "POST" }))).resolves.toBe(
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

  it("names the eight standing numbers and their profiles", () => {
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
    expect(named).toHaveLength(11);
    for (const path of named) {
      expect(WEBHOOK_PATHS, path).toContain(path);
      expect(edgeUrl(EDGE, path)).toBe(`${EDGE}${EDGE_PATHS[path]}`);
    }
    expect(() => edgeUrl(EDGE, "ctlRpc" as never)).toThrow("ctlRpc is not an edge webhook path");
  });
});
