import { describe, expect, it } from "vitest";

import { ORDER_KEYS } from "../src/telnyx/ordering";
import { EDGE, lease, N, ready, ruleOf } from './support';
import type { Harness } from './support';


function order(h: Harness, body: Record<string, unknown> = {}) {
  return h.call("/telnyx/v2/number_orders", {
    body: {
      phone_numbers: [{ phone_number: "+14165550150" }],
      billing_group_id: "bg-nonprod",
      messaging_profile_id: "prof-qa-c",
      customer_reference: "company-qa-c",
      ...body,
    },
  });
}

/** S32's lease as rigd takes it: a run that dials nothing. */
async function signUpLease(h: Harness): Promise<string> {
  const response = await h.call("/lease", { caller: "robot", body: { scenario: "S32", dials: false } });
  if (response.status !== 201) throw new Error(`lease refused: ${await response.text()}`);
  return (await response.json<{ lease_id: string }>()).lease_id;
}

const SEARCH_PATH = "/telnyx/v2/available_phone_numbers?filter[country_code]=CA";
const searches = (h: Harness) => h.telnyx.requests("GET", "/v2/available_phone_numbers").length;

describe("number search", () => {
  it("runs only under a lease for a scenario that may search", async () => {
    const h = await ready();
    await expect(ruleOf(await h.call(SEARCH_PATH))).resolves.toBe("provisioning.search_needs_lease");
    await lease(h, "S02", "rig-api");
    await expect(ruleOf(await h.call(SEARCH_PATH))).resolves.toBe("provisioning.search_needs_lease");
    expect(searches(h)).toBe(0);
  });

  it("never lets S32's lease order or change a standing number", async () => {
    const h = await ready();
    await signUpLease(h);
    await h.call("/partition", { caller: "rig-api" });
    await expect(ruleOf(await order(h))).resolves.toBe("provisioning.order_needs_lease");
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers/num-devw1", { method: "PATCH", body: { customer_reference: "x" } }))).resolves.toBe(
      "provisioning.number_standing",
    );
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers/num-devw1", { method: "DELETE" }))).resolves.toBe("provisioning.number_standing");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toEqual([]);
    expect(h.telnyx.writes()).toEqual([]);
  });
});

describe("number orders", () => {
  it("stays off until production reports the partition rule", async () => {
    const h = await ready();
    await lease(h, "S28", "rig-api");
    h.production.capabilities = [];
    await expect(ruleOf(await order(h))).resolves.toBe("provisioning.ordering_off");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toEqual([]);
  });

  it("needs the S28 lease", async () => {
    const h = await ready();
    await expect(ruleOf(await order(h))).resolves.toBe("provisioning.order_needs_lease");
  });

  it("orders with the group, a nonprod profile and a nonprod connection, adding the voice app when absent", async () => {
    const h = await ready();
    await lease(h, "S28", "rig-api");
    expect((await order(h)).status).toBe(200);
    const sent = h.telnyx.requests("POST", "/v2/number_orders")[0]?.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      billing_group_id: "bg-nonprod",
      messaging_profile_id: "prof-qa-c",
      connection_id: "conn-voice",
    });
    expect((await h.store.get<{ state: string }>(ORDER_KEYS.first))?.state).toBe("verified");
  });

  it("lets S28 search but refuses its orders outside the partition", async () => {
    const h = await ready();
    await lease(h, "S28", "rig-api");
    expect((await h.call(SEARCH_PATH)).status).toBe(200);
    expect(searches(h)).toBe(1);
    const cases: [Record<string, unknown>, string][] = [
      [{ billing_group_id: undefined }, "provisioning.order_group"],
      [{ billing_group_id: "bg-production" }, "provisioning.order_group"],
      [{ messaging_profile_id: "prof-prod" }, "provisioning.order_profile"],
      [{ messaging_profile_id: undefined }, "provisioning.order_profile"],
      [{ connection_id: "conn-prod-voice" }, "provisioning.order_connection"],
      [{ connection_id: "conn-webrtc" }, "provisioning.order_connection"],
      [{ phone_numbers: [{ phone_number: "+14165550150" }, { phone_number: "+14165550151" }] }, "provisioning.order_one_number"],
      [{ phone_numbers: [] }, "provisioning.order_one_number"],
    ];
    for (const [body, rule] of cases) await expect(ruleOf(await order(h, body))).resolves.toBe(rule);
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toEqual([]);
  });

  it("stops ordering, deleting nothing, when the group did not stick", async () => {
    const h = await ready();
    h.telnyx.dropGroupOnOrder = true;
    await lease(h, "S28", "rig-api");
    expect((await order(h)).status).toBe(200);
    await expect(h.store.get(ORDER_KEYS.stopped)).resolves.toBeDefined();
    expect(h.telnyx.numbers.some((item) => item.phone_number === "+14165550150")).toBe(true);
    expect(h.telnyx.requests("DELETE")).toEqual([]);
    const event = h.outbound.find((item) => item.url.includes("posthog.com"));
    expect(event?.body).toContain('"$exception_fingerprint":"ops:telnyx-guard-order-group"');
    // The number is still in the account, bound to nonprod resources with no group: the start-up check now reads that as unsafe.
    h.advance(24 * 60 * 60 * 1000);
    await lease(h, "S28", "rig-api");
    await expect(ruleOf(await order(h, { phone_numbers: [{ phone_number: "+14165550151" }] }))).resolves.toBe("startup.unsafe");
  });

  it("waits for the first order's read-back before ordering again", async () => {
    const h = await ready();
    await h.store.put(ORDER_KEYS.first, { state: "pending", order_id: null, phone_number: "+14165550159", at: h.clock.now });
    await lease(h, "S28", "rig-api");
    await expect(ruleOf(await order(h))).resolves.toBe("provisioning.ordering_off");
  });
});

describe("number changes", () => {
  it("patches and deletes only owned numbers that are not standing", async () => {
    const h = await ready();
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers/num-prod", { method: "PATCH", body: { customer_reference: "x" } }))).resolves.toBe(
      "provisioning.number_not_owned",
    );
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers/num-devw1", { method: "PATCH", body: { customer_reference: "x" } }))).resolves.toBe(
      "provisioning.number_standing",
    );
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers/num-devw1", { method: "DELETE" }))).resolves.toBe(
      "provisioning.number_standing",
    );
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers/num-prod", { method: "DELETE" }))).resolves.toBe(
      "provisioning.number_not_owned",
    );
    expect(h.telnyx.writes()).toEqual([]);

    expect((await h.call("/telnyx/v2/phone_numbers/num-scratch", { method: "PATCH", body: { connection_id: "conn-voice" } })).status).toBe(200);
    expect((await h.call("/telnyx/v2/phone_numbers/num-scratch", { method: "PATCH", body: { customer_reference: "x" } })).status).toBe(200);
    expect((await h.call("/telnyx/v2/phone_numbers/num-scratch", { method: "DELETE" })).status).toBe(200);
  });

  it("treats a number with the standing tag as standing even when the store forgot it", async () => {
    const h = await ready();
    await h.store.delete("partition:standing");
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers/num-robot1", { method: "DELETE" }))).resolves.toBe(
      "provisioning.number_standing",
    );
  });

  it("allows only partition-preserving fields on a number", async () => {
    const h = await ready();
    const patch = (body: Record<string, unknown>) => h.call("/telnyx/v2/phone_numbers/num-scratch", { method: "PATCH", body });
    for (const body of [
      { connection_id: "conn-prod-voice" },
      { connection_id: "conn-webrtc" },
      { billing_group_id: "bg-production" },
      { billing_group_id: null },
      { tags: ["rig-standing"] },
      { external_pin: "1234" },
    ]) {
      await expect(ruleOf(await patch(body))).resolves.toBe("provisioning.patch_field");
    }
  });

  it("allows app screening and caller-name settings only on owned non-standing numbers", async () => {
    const h = await ready();
    const patch = (body: Record<string, unknown>, number = "num-scratch") =>
      h.call(`/telnyx/v2/phone_numbers/${number}/voice`, { method: "PATCH", body });
    await expect(ruleOf(await patch({ call_forwarding: { call_forwarding_enabled: true, forwards_to: N.notOwned } }))).resolves.toBe(
      "provisioning.patch_field",
    );
    await expect(ruleOf(await patch({ translated_number: N.notOwned }))).resolves.toBe("provisioning.patch_field");
    await expect(ruleOf(await patch({ inbound_call_screening: "reject_calls" }))).resolves.toBe("provisioning.patch_field");
    await expect(ruleOf(await patch({ inbound_call_screening: "flag_calls" }, "num-prod"))).resolves.toBe("provisioning.number_not_owned");
    await expect(ruleOf(await patch({ inbound_call_screening: "flag_calls" }, "num-devw1"))).resolves.toBe("provisioning.number_standing");
    expect(h.telnyx.requests("PATCH")).toEqual([]);
    const screening = { inbound_call_screening: "flag_calls", caller_id_name_enabled: true, cnam_listing: { cnam_listing_enabled: false } };
    expect((await patch(screening)).status).toBe(200);
    expect((await patch({ inbound_call_screening: "disabled" })).status).toBe(200);
    expect(h.telnyx.requests("PATCH", "/v2/phone_numbers/num-scratch/voice").map((request) => request.body)).toEqual([
      screening,
      { inbound_call_screening: "disabled" },
    ]);
  });
});

describe("messaging profiles", () => {
  const PROFILE = {
    name: "company-x",
    webhook_url: `${EDGE}/t/m`,
    webhook_failover_url: `${EDGE}/t/m`,
    whitelisted_destinations: ["US", "CA"],
    daily_spend_limit: "0.03",
    daily_spend_limit_enabled: true,
  };
  const create = (h: Harness, body: Record<string, unknown>) => h.call("/telnyx/v2/messaging_profiles", { body: { ...PROFILE, ...body } });

  it("requires a US/CA whitelist and edge webhooks", async () => {
    const h = await ready();
    const cases: [Record<string, unknown>, string][] = [
      [{ whitelisted_destinations: ["US", "GB"] }, "provisioning.profile_whitelist"],
      [{ whitelisted_destinations: [] }, "provisioning.profile_whitelist"],
      [{ webhook_url: "https://api.loonext.com/webhooks/telnyx" }, "provisioning.profile_webhook"],
      [{ webhook_failover_url: "https://somewhere.example" }, "provisioning.profile_webhook"],
    ];
    for (const [body, rule] of cases) await expect(ruleOf(await create(h, body))).resolves.toBe(rule);
  });

  it("returns the new profile without its v1 secret", async () => {
    const h = await ready();
    const body = await (await create(h, {})).json<{ data: Record<string, unknown> }>();
    expect(body.data).toMatchObject({ name: "company-x" });
    expect(body.data).not.toHaveProperty("v1_secret");
    expect(h.telnyx.lists.messaging_profiles.at(-1)).toHaveProperty("v1_secret");
  });
});

describe("telephony credentials", () => {
  it("creates credentials only on the rig's two credential connections", async () => {
    const h = await ready();
    await expect(ruleOf(await h.call("/telnyx/v2/telephony_credentials", { body: { connection_id: "conn-prod-webrtc" } }))).resolves.toBe(
      "provisioning.credential_connection",
    );
    await expect(ruleOf(await h.call("/telnyx/v2/telephony_credentials", { body: { connection_id: "conn-voice" } }))).resolves.toBe(
      "provisioning.credential_connection",
    );
    const created = await h.call("/telnyx/v2/telephony_credentials", { body: { connection_id: "conn-webrtc", name: "m1" } });
    expect(created.status).toBe(201);
    const {data} = (await created.json<{ data: Record<string, unknown> }>());
    expect(data.sip_username).toMatch(/^gencred/);
    expect(data).not.toHaveProperty("sip_password");
  });

  it("deletes and mints tokens only for nonprod credentials", async () => {
    const h = await ready();
    await expect(ruleOf(await h.call("/telnyx/v2/telephony_credentials/cred-prod", { method: "DELETE" }))).resolves.toBe(
      "provisioning.credential_not_nonprod",
    );
    await expect(ruleOf(await h.call("/telnyx/v2/telephony_credentials/cred-prod/token", { method: "POST", body: {} }))).resolves.toBe(
      "provisioning.credential_not_nonprod",
    );
    const token = await h.call("/telnyx/v2/telephony_credentials/cred-owner/token", { method: "POST", body: {} });
    expect(token.status).toBe(201);
    await expect(token.text()).resolves.toBe("jwt-token-text");
  });

  it("stops dialling a SIP user once its credential is deleted", async () => {
    const h = await ready();
    const id = await lease(h, "S02");
    const dial = () =>
      h.call("/telnyx/v2/calls", {
        caller: "robot",
        body: { connection_id: "conn-voice", from: N.devW1, to: "sip:gencredowner@sip.telnyx.com" },
        headers: { "x-rig-lease": id },
      });
    expect((await dial()).status).toBe(200);
    expect((await h.call("/telnyx/v2/telephony_credentials/cred-owner", { method: "DELETE" })).status).toBe(200);
    await expect(ruleOf(await dial())).resolves.toBe("dial.to_not_owned");
  });
});
