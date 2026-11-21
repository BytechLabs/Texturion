import { EDGE_PATHS, HEADER } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { EDGE, lease, N, ready, registerViaEdge, ruleOf } from "./support";

type Listing = { data: Record<string, unknown>[] };

describe("read class", () => {
  it("forces the partition's billing group onto the number listing", async () => {
    const h = await ready();
    const response = await h.call("/telnyx/v2/phone_numbers?page[size]=250&filter[billing_group_id]=null");
    expect(response.status).toBe(200);
    const sent = h.telnyx.requests("GET", "/v2/phone_numbers").at(-1);
    expect(sent?.query.getAll("filter[billing_group_id]")).toEqual(["bg-nonprod"]);
    const numbers = (await response.json<Listing>()).data.map((item) => item.phone_number);
    expect(numbers).not.toContain(N.production);
    expect(numbers).toContain(N.devW1);
  });

  it("filters the answer again when Telnyx ignores the filter", async () => {
    const h = await ready();
    h.telnyx.ignoreFilters = true;
    const response = await h.call("/telnyx/v2/phone_numbers");
    const numbers = (await response.json<Listing>()).data;
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every((item) => item.billing_group_id === "bg-nonprod")).toBe(true);
  });

  it("refuses a single number outside the partition", async () => {
    const h = await ready();
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers/num-prod"))).resolves.toBe("read.not_in_partition");
    expect((await h.call("/telnyx/v2/phone_numbers/num-devw1")).status).toBe(200);
  });

  it("asks nothing of Telnyx for a non-owned number's voice settings", async () => {
    const h = await ready();
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers/num-prod/voice"))).resolves.toBe("read.not_in_partition");
    expect(h.telnyx.requests("GET", "/v2/phone_numbers/num-prod")).toEqual([]);
    expect((await h.call("/telnyx/v2/phone_numbers/num-devw1/voice")).status).toBe(200);
  });

  it("reads a call's status only for a registered leg", async () => {
    const h = await ready();
    h.telnyx.calls.set("ccid-prod", { alive: true });
    await expect(ruleOf(await h.call("/telnyx/v2/calls/ccid-prod"))).resolves.toBe("read.leg_not_registered");
    expect(h.telnyx.requests("GET", "/v2/calls/ccid-prod")).toEqual([]);

    h.telnyx.calls.set("ccid-rig", { alive: true });
    await registerViaEdge(h, "ccid-rig");
    expect((await h.call("/telnyx/v2/calls/ccid-rig")).status).toBe(200);
  });

  it("needs a call filter on recordings and keeps only nonprod ones", async () => {
    const h = await ready();
    h.telnyx.lists.recordings.push(
      { id: "rec-rig", call_session_id: "s1", connection_id: "conn-voice", call_control_id: "c1" },
      { id: "rec-prod", call_session_id: "s1", connection_id: "conn-prod-voice", call_control_id: "c2" },
    );
    await expect(ruleOf(await h.call("/telnyx/v2/recordings"))).resolves.toBe("read.filter_required");
    const response = await h.call("/telnyx/v2/recordings?filter[call_session_id]=s1");
    expect((await response.json<Listing>()).data.map((item) => item.id)).toEqual(["rec-rig"]);
  });

  it("returns only this run's rig voice delivery evidence even if Telnyx ignores the filters", async () => {
    const h = await ready();
    const since = new Date(h.clock.now).toISOString();
    const listing = "/telnyx/v2/webhook_deliveries";
    const path = `${listing}?filter[started_at][gte]=${encodeURIComponent(since)}`;
    await expect(ruleOf(await h.call(path, { caller: "robot" }))).resolves.toBe("read.filter_not_nonprod");
    await lease(h, "S17");
    await expect(ruleOf(await h.call(path))).resolves.toBe("read.filter_not_nonprod");
    await expect(ruleOf(await h.call(listing, { caller: "robot" }))).resolves.toBe("read.filter_required");

    const attempt = (url: string, status: number) => ({
      started_at: since,
      http: { request: { url, headers: [["secret", "do not return"]] }, response: { status, body: "do not return" } },
    });
    const delivery = {
      id: "delivery-rig",
      status: "delivered",
      started_at: since,
      webhook: { id: "event-1", event_type: "call.initiated", payload: { connection_id: "conn-voice" } },
      attempts: [
        attempt(EDGE + EDGE_PATHS.telnyxVoice, 503),
        attempt(EDGE + EDGE_PATHS.telnyxVoiceFailover, 200),
        attempt("https://production.example/calls", 200),
      ],
    };
    h.telnyx.ignoreFilters = true;
    h.telnyx.lists.webhook_deliveries.push(delivery, {
      ...delivery,
      id: "delivery-prod",
      webhook: { ...delivery.webhook, payload: { connection_id: "conn-prod-voice" } },
    }, { ...delivery, id: "delivery-old", started_at: new Date(h.clock.now - 1000).toISOString() });

    const response = await h.call(path, { caller: "robot" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [{
      id: "delivery-rig",
      status: "delivered",
      webhook: { id: "event-1", event_type: "call.initiated" },
      attempts: [
        { started_at: since, http: { request: { url: EDGE + EDGE_PATHS.telnyxVoice }, response: { status: 503 } } },
        { started_at: since, http: { request: { url: EDGE + EDGE_PATHS.telnyxVoiceFailover }, response: { status: 200 } } },
      ],
    }] });
  });

  it("refuses an unfiltered or foreign opt-out list, and keeps only nonprod rows", async () => {
    const h = await ready();
    h.telnyx.ignoreFilters = true;
    h.telnyx.lists.messaging_optouts.push(
      { from: N.robot2, messaging_profile_id: "prof-qa-e" },
      { from: N.notOwned, messaging_profile_id: "prof-prod" },
    );
    await expect(ruleOf(await h.call("/telnyx/v2/messaging_optouts"))).resolves.toBe("read.filter_required");
    await expect(ruleOf(await h.call("/telnyx/v2/messaging_optouts?filter[messaging_profile_id]=prof-prod"))).resolves.toBe(
      "read.filter_not_nonprod",
    );
    const response = await h.call("/telnyx/v2/messaging_optouts?filter[messaging_profile_id]=prof-qa-e");
    expect((await response.json<Listing>()).data).toEqual([{ from: N.robot2, messaging_profile_id: "prof-qa-e" }]);
  });

  it("refuses a number order outside the partition", async () => {
    const h = await ready();
    h.telnyx.numberOrders.push(
      { id: "order-prod", billing_group_id: null },
      { id: "order-rig", billing_group_id: "bg-nonprod" },
    );
    await expect(ruleOf(await h.call("/telnyx/v2/number_orders/order-prod"))).resolves.toBe("read.not_in_partition");
    expect((await h.call("/telnyx/v2/number_orders/order-rig")).status).toBe(200);
  });

  it("refuses the fixed account-wide reads without asking Telnyx", async () => {
    const h = await ready();
    for (const path of [
      "/v2/10dlc/brand",
      "/v2/10dlc/campaign/c1",
      "/v2/porting_orders/p1",
      "/v2/api_keys",
      "/v2/managed_accounts",
      "/v2/messaging_hosted_number_orders/h1",
    ]) {
      await expect(ruleOf(await h.call(`/telnyx${path}`))).resolves.toBe("read.account_wide");
    }
    expect(h.telnyx.log).toEqual([]);
  });

  it("returns the balance as a number and nothing else", async () => {
    const h = await ready();
    const response = await h.call("/telnyx/v2/balance");
    await expect(response.json()).resolves.toEqual({ data: { balance: 500 } });
  });

  it("refuses an endpoint the registry does not list", async () => {
    const h = await ready();
    for (const path of ["/v2/call_control_applications", "/v2/connections", "/v2/phone_numbers/num-devw1/messaging"]) {
      await expect(ruleOf(await h.call(`/telnyx${path}`))).resolves.toBe("registry.missing");
    }
    expect(h.telnyx.log).toEqual([]);
  });

  it("refuses registered endpoints of the refused class", async () => {
    const h = await ready();
    await expect(ruleOf(await h.call("/telnyx/v2/documents", { body: {} }))).resolves.toBe("refused.documents");
    await expect(ruleOf(await h.call("/telnyx/v2/documents/d1/download"))).resolves.toBe("refused.documents");
    await expect(ruleOf(await h.call("/telnyx/v2/portability_checks", { body: {} }))).resolves.toBe("refused.porting");
    expect(h.telnyx.log).toEqual([]);
  });

  it("refuses a malformed path before matching it", async () => {
    const h = await ready();
    await expect(ruleOf(await h.call("/telnyx/v2/calls/x%2F..%2Fy/actions/hangup", { body: {} }))).resolves.toBe(
      "request.malformed_path",
    );
  });
});

describe("the owned set, when Telnyx ignores the group filter", () => {
  // Owned from and to are what keep every call and text between the rig's own
  // numbers, so the owned listing is checked item by item, not trusted.
  it("still leaves production's numbers out of the partition", async () => {
    const h = await ready();
    h.telnyx.ignoreFilters = true;
    const partition = await (await h.call("/partition", { caller: "edge" })).json<{ owned_e164: string[] }>();
    expect(partition.owned_e164).toContain(N.devW1);
    expect(partition.owned_e164).not.toContain(N.production);
  });

  it("still refuses a dial or a text to or from a production number", async () => {
    const h = await ready();
    h.telnyx.ignoreFilters = true;
    const id = await lease(h);
    const dial = (body: Record<string, unknown>) =>
      h.call("/telnyx/v2/calls", { caller: "robot", body: { connection_id: "conn-robot", ...body }, headers: { [HEADER.lease]: id } });
    await expect(ruleOf(await dial({ from: N.robot1, to: N.production }))).resolves.toBe("dial.to_not_owned");
    await expect(ruleOf(await dial({ from: N.production, to: N.devW1 }))).resolves.toBe("dial.from_not_owned");
    const text = (body: Record<string, unknown>) => h.call("/telnyx/v2/messages", { body: { text: "x", ...body } });
    await expect(ruleOf(await text({ from: N.devW1, to: N.production }))).resolves.toBe("message.to_not_owned");
    await expect(ruleOf(await text({ from: N.production, to: N.devW1 }))).resolves.toBe("message.from_not_owned");
    expect(h.telnyx.writes()).toEqual([]);
  });
});

describe("every read", () => {
  it("never return a credential-named field, whatever the read", async () => {
    const h = await ready();
    h.telnyx.numbers[0].v1_secret = "fake-v1-secret";
    h.telnyx.numbers[0].settings = { password: "fake-password" };
    const listing = await (await h.call("/telnyx/v2/phone_numbers")).json<Listing>();
    expect(listing.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(listing)).not.toMatch(/fake-v1-secret|fake-password/);
  });
});
