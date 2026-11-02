import { HEADER } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import type { TelnyxRequest } from "../src/telnyx/forward";
import { loadPartition } from "../src/telnyx/partition";
import { READ_RULES } from "../src/telnyx/read";
import { lease, N, ready, registerViaEdge, ruleOf, type Harness } from "./support";

type Listing = { data: Record<string, unknown>[] };

describe("read class", () => {
  it("forces the partition's billing group onto the number listing", async () => {
    const h = await ready();
    const response = await h.call("/telnyx/v2/phone_numbers?page[size]=250&filter[billing_group_id]=null");
    expect(response.status).toBe(200);
    const sent = h.telnyx.requests("GET", "/v2/phone_numbers").at(-1);
    expect(sent?.query.getAll("filter[billing_group_id]")).toEqual(["bg-nonprod"]);
    const numbers = ((await response.json()) as Listing).data.map((item) => item.phone_number);
    expect(numbers).not.toContain(N.production);
    expect(numbers).toContain(N.devW1);
  });

  it("filters the answer again when Telnyx ignores the filter", async () => {
    const h = await ready();
    h.telnyx.ignoreFilters = true;
    const response = await h.call("/telnyx/v2/phone_numbers");
    const numbers = ((await response.json()) as Listing).data;
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every((item) => item.billing_group_id === "bg-nonprod")).toBe(true);
  });

  it("refuses a single number outside the partition", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-prod"))).toBe("read.not_in_partition");
    expect((await h.call("/telnyx/v2/phone_numbers/num-devw1")).status).toBe(200);
  });

  it("asks nothing of Telnyx for a non-owned number's voice settings", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-prod/voice"))).toBe("read.not_in_partition");
    expect(h.telnyx.requests("GET", "/v2/phone_numbers/num-prod")).toEqual([]);
    expect((await h.call("/telnyx/v2/phone_numbers/num-devw1/voice")).status).toBe(200);
  });

  it("reads a call's status only for a registered leg", async () => {
    const h = await ready();
    h.telnyx.calls.set("ccid-prod", { alive: true });
    expect(await ruleOf(await h.call("/telnyx/v2/calls/ccid-prod"))).toBe("read.leg_not_registered");
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
    expect(await ruleOf(await h.call("/telnyx/v2/recordings"))).toBe("read.filter_required");
    const response = await h.call("/telnyx/v2/recordings?filter[call_session_id]=s1");
    expect(((await response.json()) as Listing).data.map((item) => item.id)).toEqual(["rec-rig"]);
  });

  it("refuses an unfiltered or foreign opt-out list, and keeps only nonprod rows", async () => {
    const h = await ready();
    h.telnyx.ignoreFilters = true;
    h.telnyx.lists.messaging_optouts.push(
      { from: N.robot2, messaging_profile_id: "prof-qa-e" },
      { from: N.notOwned, messaging_profile_id: "prof-prod" },
    );
    expect(await ruleOf(await h.call("/telnyx/v2/messaging_optouts"))).toBe("read.filter_required");
    expect(await ruleOf(await h.call("/telnyx/v2/messaging_optouts?filter[messaging_profile_id]=prof-prod"))).toBe(
      "read.filter_not_nonprod",
    );
    const response = await h.call("/telnyx/v2/messaging_optouts?filter[messaging_profile_id]=prof-qa-e");
    expect(((await response.json()) as Listing).data).toEqual([{ from: N.robot2, messaging_profile_id: "prof-qa-e" }]);
  });

  it("refuses a number order outside the partition", async () => {
    const h = await ready();
    h.telnyx.numberOrders.push(
      { id: "order-prod", billing_group_id: null },
      { id: "order-rig", billing_group_id: "bg-nonprod" },
    );
    expect(await ruleOf(await h.call("/telnyx/v2/number_orders/order-prod"))).toBe("read.not_in_partition");
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
      expect(await ruleOf(await h.call(`/telnyx${path}`)), path).toBe("read.account_wide");
    }
    expect(h.telnyx.log).toEqual([]);
  });

  it("returns the balance as a number and nothing else", async () => {
    const h = await ready();
    const response = await h.call("/telnyx/v2/balance");
    expect(await response.json()).toEqual({ data: { balance: 500 } });
  });

  it("refuses an endpoint the registry does not list", async () => {
    const h = await ready();
    for (const path of ["/v2/call_control_applications", "/v2/connections", "/v2/phone_numbers/num-devw1/messaging"]) {
      expect(await ruleOf(await h.call(`/telnyx${path}`)), path).toBe("registry.missing");
    }
    expect(h.telnyx.log).toEqual([]);
  });

  it("refuses registered endpoints of the refused class", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call("/telnyx/v2/documents", { body: {} }))).toBe("refused.documents");
    expect(await ruleOf(await h.call("/telnyx/v2/documents/d1/download"))).toBe("refused.documents");
    expect(await ruleOf(await h.call("/telnyx/v2/portability_checks", { body: {} }))).toBe("refused.porting");
    expect(h.telnyx.log).toEqual([]);
  });

  it("refuses a malformed path before matching it", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call("/telnyx/v2/calls/x%2F..%2Fy/actions/hangup", { body: {} }))).toBe(
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
    const partition = (await (await h.call("/partition", { caller: "edge" })).json()) as { owned_e164: string[] };
    expect(partition.owned_e164).toContain(N.devW1);
    expect(partition.owned_e164).not.toContain(N.production);
  });

  it("still refuses a dial or a text to or from a production number", async () => {
    const h = await ready();
    h.telnyx.ignoreFilters = true;
    const id = await lease(h);
    const dial = (body: Record<string, unknown>) =>
      h.call("/telnyx/v2/calls", { caller: "robot", body: { connection_id: "conn-robot", ...body }, headers: { [HEADER.lease]: id } });
    expect(await ruleOf(await dial({ from: N.robot1, to: N.production }))).toBe("dial.to_not_owned");
    expect(await ruleOf(await dial({ from: N.production, to: N.devW1 }))).toBe("dial.from_not_owned");
    const text = (body: Record<string, unknown>) => h.call("/telnyx/v2/messages", { body: { text: "x", ...body } });
    expect(await ruleOf(await text({ from: N.devW1, to: N.production }))).toBe("message.to_not_owned");
    expect(await ruleOf(await text({ from: N.production, to: N.devW1 }))).toBe("message.from_not_owned");
    expect(h.telnyx.writes()).toEqual([]);
  });
});

describe("read rules for the production watches' reads", () => {
  async function read(h: Harness, key: string, ids: string[], data: unknown): Promise<unknown> {
    const view = await loadPartition(h.ctx);
    const request = {
      ctx: h.ctx,
      caller: "rig-api",
      method: "GET",
      path: "/v2/x",
      query: new URLSearchParams(),
      ids,
      entry: { key } as TelnyxRequest["entry"],
      body: undefined,
      bodyInvalid: false,
      lease: null,
      idempotencyKey: null,
      view,
    } satisfies TelnyxRequest;
    const rule = READ_RULES[key];
    await rule.prepare?.(request);
    const items = Array.isArray(data) ? data : [data];
    const kept = [];
    for (const item of items) if (await rule.keep(item as Record<string, unknown>, request)) kept.push(item);
    return kept;
  }

  it("read one nonprod app or connection by id, and refuse production's before asking", async () => {
    const h = await ready();
    expect(await read(h, "GET /v2/call_control_applications/:id", ["conn-voice"], { id: "conn-voice" })).toHaveLength(1);
    await expect(read(h, "GET /v2/call_control_applications/:id", ["conn-prod-voice"], {})).rejects.toMatchObject({
      rule: "read.not_in_partition",
    });
    expect(await read(h, "GET /v2/credential_connections/:id", ["conn-webrtc"], { id: "conn-webrtc" })).toHaveLength(1);
    await expect(read(h, "GET /v2/credential_connections/:id", ["conn-prod-webrtc"], {})).rejects.toMatchObject({
      rule: "read.not_in_partition",
    });
  });

  it("read one nonprod outbound voice profile by id, and refuse production's before asking", async () => {
    const h = await ready();
    expect(await read(h, "GET /v2/outbound_voice_profiles/:id", ["ovp-voice"], { id: "ovp-voice" })).toHaveLength(1);
    await expect(read(h, "GET /v2/outbound_voice_profiles/:id", ["ovp-prod"], {})).rejects.toMatchObject({
      rule: "read.not_in_partition",
    });
  });

  it("keep only nonprod profiles and deliveries for nonprod resources", async () => {
    const h = await ready();
    expect(await read(h, "GET /v2/messaging_profiles", [], [{ id: "prof-qa-w" }, { id: "prof-prod" }])).toEqual([
      { id: "prof-qa-w" },
    ]);
    const deliveries = [
      { id: "d1", webhook: { payload: { connection_id: "conn-voice" } } },
      { id: "d2", webhook: { payload: { connection_id: "conn-prod-voice" } } },
      { id: "d3", webhook: { payload: { messaging_profile_id: "prof-robot" } } },
      { id: "d4", webhook: { payload: { messaging_profile_id: "prof-prod" } } },
      { id: "d5" },
    ];
    expect(((await read(h, "GET /v2/webhook_deliveries", [], deliveries)) as { id: string }[]).map((item) => item.id)).toEqual([
      "d1",
      "d3",
    ]);
  });

  it("never return a credential-named field, whatever the read", async () => {
    const h = await ready();
    h.telnyx.numbers[0].v1_secret = "fake-v1-secret";
    h.telnyx.numbers[0].settings = { password: "fake-password" };
    const listing = (await (await h.call("/telnyx/v2/phone_numbers")).json()) as Listing;
    expect(listing.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(listing)).not.toMatch(/fake-v1-secret|fake-password/);
  });
});
