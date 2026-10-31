import { describe, expect, it } from "vitest";

import { CRONS } from "../src/guard";
import { harness, ready, type Harness } from "./support";

const inventoryEvents = (h: Harness) =>
  h.outbound.filter((item) => item.body.includes('"fingerprint":["ops","telnyx-key-inventory"]'));

describe("the weekly key inventory", () => {
  it("runs on its cron and raises an event until a baseline is accepted", async () => {
    const h = await ready();
    h.telnyx.lists.oauth_clients.push({ client_id: "client-founder" });
    await h.guard.cron(CRONS.keyInventory);
    expect(inventoryEvents(h)).toHaveLength(1);
    expect(inventoryEvents(h)[0].body).toContain("no accepted baseline");

    expect((await h.call("/admin/key-inventory/accept", { caller: "admin", method: "POST" })).status).toBe(200);
    h.advance(7 * 24 * 60 * 60 * 1000);
    await h.guard.cron(CRONS.keyInventory);
    expect(inventoryEvents(h)).toHaveLength(1);
  });

  it("raises a production event for a credential outside the baseline", async () => {
    const h = await ready();
    h.telnyx.apiKeys = [{ id: "key-production" }, { id: "key-guard" }];
    await h.guard.cron(CRONS.keyInventory);
    await h.call("/admin/key-inventory/accept", { caller: "admin", method: "POST" });

    h.telnyx.apiKeys.push({ id: "key-unexpected" });
    h.telnyx.lists.oauth_grants.push({ id: "grant-unexpected" });
    h.advance(7 * 24 * 60 * 60 * 1000);
    const response = await h.call("/admin/key-inventory/run", { caller: "admin", method: "POST" });
    expect(((await response.json()) as { unexpected: string[] }).unexpected).toEqual([
      "api_key:key-unexpected",
      "oauth_grant:grant-unexpected",
    ]);
    const event = inventoryEvents(h).at(-1);
    expect(event?.url).toBe("https://o1.ingest.sentry.example/api/12345/envelope/");
    expect(event?.body).toContain('"level":"error"');
  });

  it("reads key activity in the audit log since the last run", async () => {
    const h = await ready();
    await h.guard.cron(CRONS.keyInventory);
    await h.call("/admin/key-inventory/accept", { caller: "admin", method: "POST" });
    h.telnyx.lists.audit_events.push(
      { record_type: "api_key", resource_id: "key-new", change_type: "create" },
      { record_type: "phone_number", resource_id: "num-1", change_type: "update" },
    );
    const result = await (await h.call("/admin/key-inventory/run", { caller: "admin", method: "POST" })).json();
    expect(result).toMatchObject({ unexpected: ["audit:api_key:key-new"] });
  });

  it("keeps reading when one source is refused, and alerts when none answers", async () => {
    const h = await ready();
    h.telnyx.failNext = { method: "GET", path: "/v2/audit_events", status: 403 };
    const partial = await (await h.call("/admin/key-inventory/run", { caller: "admin", method: "POST" })).json();
    expect(partial).toMatchObject({ unexpected: ["no_accepted_baseline"] });

    const blind = await ready();
    const realHandle = blind.telnyx.handle.bind(blind.telnyx);
    blind.telnyx.handle = async (request) =>
      new URL(request.url).pathname.match(/oauth|audit|api_keys/) ? new Response("{}", { status: 403 }) : realHandle(request);
    const result = await (await blind.call("/admin/key-inventory/run", { caller: "admin", method: "POST" })).json();
    expect(result).toMatchObject({ unexpected: ["inventory_unreadable"] });
    expect(inventoryEvents(blind)).toHaveLength(1);
  });

  it("does nothing without the Telnyx key; /health already says so", async () => {
    const h = harness({ env: { TELNYX_API_KEY: "" } });
    await h.guard.cron(CRONS.keyInventory);
    expect(h.outbound).toEqual([]);
  });
});
