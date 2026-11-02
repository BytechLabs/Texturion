import { HEADER } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { refuse, RULES, statusFor } from "../src/refusal";
import { harness, ready, ruleOf } from "./support";

describe("the caller class", () => {
  it("is refused at the Worker before the Durable Object when unknown or absent", async () => {
    let reached = false;
    const env = {
      GUARD: {
        idFromName: () => ({}),
        get: () => ({
          fetch: async () => {
            reached = true;
            return new Response("{}");
          },
        }),
      },
    } as never;
    for (const value of [null, "", "customer", "RIG-API", "rig_api"]) {
      const headers = new Headers();
      if (value !== null) headers.set(HEADER.callerClass, value);
      const response = await worker.fetch(new Request("https://guard.internal/health", { headers }), env);
      expect(await ruleOf(response)).toBe("class.unknown");
    }
    expect(reached).toBe(false);
  });

  it("is refused by the guard itself too", async () => {
    const h = harness();
    expect(await ruleOf(await h.call("/health", { caller: null }))).toBe("class.unknown");
    expect(await ruleOf(await h.call("/health", { caller: "production" }))).toBe("class.unknown");
  });

  it("limits each class to its routes", async () => {
    const h = await ready();
    const cases: [string, string, string][] = [
      ["diag", "/telnyx/v2/phone_numbers", "class.not_allowed"],
      ["diag", "/resend/emails", "class.not_allowed"],
      ["robot", "/admin/setup", "class.not_allowed"],
      ["rig-api", "/admin/setup", "class.not_allowed"],
      ["rig-api", "/legs", "class.not_allowed"],
      ["robot", "/reject", "class.not_allowed"],
      ["admin", "/legs", "class.not_allowed"],
      ["rig-api", "/halt", "class.not_allowed"],
      ["robot", "/detach", "class.not_allowed"],
      ["admin", "/halt", "class.not_allowed"],
      ["rig-api", "/diag/v2/webhook_deliveries", "class.not_allowed"],
      ["robot", "/fcm/v1/projects/p/messages:send", "class.not_allowed"],
      // The edge reaches only its own routes and its two reads.
      ["edge", "/health", "class.not_allowed"],
      ["edge", "/version", "class.not_allowed"],
      ["edge", "/lease", "class.not_allowed"],
      ["edge", "/admin/check", "class.not_allowed"],
      ["edge", "/resend/emails", "class.not_allowed"],
      ["edge", "/ai/run/x", "class.not_allowed"],
      ["edge", "/diag/v2/webhook_deliveries", "class.not_allowed"],
    ];
    for (const [caller, path, rule] of cases) {
      expect(await ruleOf(await h.call(path, { caller, method: "POST", body: {} })), `${caller} ${path}`).toBe(rule);
    }
  });

  it("refuses the robot anything that buys or binds", async () => {
    const h = await ready();
    const response = await h.call("/telnyx/v2/number_orders", { caller: "robot", body: { phone_numbers: [] } });
    expect(await ruleOf(response)).toBe("class.not_allowed");
    expect(h.telnyx.writes()).toEqual([]);
  });

  it("lets the edge read only the balance and the notification events through the Telnyx route", async () => {
    const h = await ready();
    for (const path of ["/telnyx/v2/phone_numbers", "/telnyx/v2/calls/c1", "/telnyx/v2/notification_settings"]) {
      expect(await ruleOf(await h.call(path, { caller: "edge" })), path).toBe("class.not_allowed");
    }
    expect(await ruleOf(await h.call("/telnyx/v2/messages", { caller: "edge", body: {} }))).toBe("class.not_allowed");
    const balance = await h.call("/telnyx/v2/balance", { caller: "edge" });
    expect(await balance.json()).toEqual({ data: { balance: 500 } });
    h.telnyx.lists.notification_events = [{ id: "ev-1", name: "Low Balance", enabled: true }];
    const events = await h.call("/telnyx/v2/notification_events?page[size]=250", { caller: "edge" });
    expect(await events.json()).toMatchObject({ data: [{ name: "Low Balance", enabled: true }] });
  });

  it("passes Telnyx's own refusal of the balance read through unmarked, as evidence of a disabled account", async () => {
    const h = await ready();
    h.telnyx.failNext = { method: "GET", path: "/v2/balance", status: 403 };
    const response = await h.call("/telnyx/v2/balance", { caller: "edge" });
    expect(response.status).toBe(403);
    expect(response.headers.get(HEADER.refusedBy)).toBeNull();
  });

  it("serves the partition to the edge, which decides webhook ownership from it", async () => {
    const h = await ready();
    expect((await h.call("/partition", { caller: "edge" })).status).toBe(200);
  });

  it("answers an unknown route with a refusal, not a 404 that looks like Telnyx's", async () => {
    const h = harness();
    expect(await ruleOf(await h.call("/v2/calls"))).toBe("route.unknown");
    expect(await ruleOf(await h.call("/"))).toBe("route.unknown");
  });
});

describe("refusals", () => {
  it("carry the protocol body and the refused-by header", async () => {
    const response = refuse("dial.to_not_owned");
    expect(response.status).toBe(403);
    expect(response.headers.get(HEADER.refusedBy)).toBe("dial.to_not_owned");
    expect(await response.json()).toEqual({ error: "guard_refused", rule: "dial.to_not_owned" });
  });

  it("are 429 for a spent budget and 403 for everything else", () => {
    for (const rule of RULES) {
      const spent =
        rule.startsWith("budget.") ||
        rule === "provisioning.search_rate" ||
        rule === "provisioning.search_cap" ||
        rule === "provisioning.order_interval";
      expect(statusFor(rule), rule).toBe(spent ? 429 : 403);
    }
  });

  it("have unique, dotted names", () => {
    expect(new Set(RULES).size).toBe(RULES.length);
    for (const rule of RULES) expect(rule).toMatch(/^[a-z0-9]+\.[a-z0-9_]+$/);
  });
});
