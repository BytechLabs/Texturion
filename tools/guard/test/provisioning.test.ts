import { describe, expect, it } from "vitest";

import { LEASE_SEARCH_SPACING_MS, SEARCH_PER_LEASE } from "../src/limits";
import { charge, readTier } from "../src/state/ledger";
import { ORDER_KEYS } from "../src/telnyx/ordering";
import { EDGE, lease, N, ready, ruleOf, type Harness } from "./support";

const DAY = 24 * 60 * 60 * 1000;

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
  return ((await response.json()) as { lease_id: string }).lease_id;
}

const SEARCH_PATH = "/telnyx/v2/available_phone_numbers?filter[country_code]=CA";
const searches = (h: Harness) => h.telnyx.requests("GET", "/v2/available_phone_numbers").length;

describe("number search", () => {
  it("runs only under a lease for a scenario that may search", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call(SEARCH_PATH))).toBe("provisioning.search_needs_lease");
    for (const scenario of ["S02", "S28"]) {
      const id = await lease(h, scenario, "rig-api");
      expect(await ruleOf(await h.call(SEARCH_PATH)), scenario).toBe("provisioning.search_needs_lease");
      await h.call(`/lease/${id}`, { method: "DELETE" });
    }
    expect(searches(h)).toBe(0);
  });

  it("forwards S32's searches a second apart, up to the lease's cap", async () => {
    const h = await ready();
    await signUpLease(h);
    expect((await h.call(SEARCH_PATH)).status).toBe(200);
    expect(searches(h)).toBe(1);
    h.advance(2_000);
    expect((await h.call(SEARCH_PATH)).status).toBe(200);
    expect(await ruleOf(await h.call(SEARCH_PATH))).toBe("provisioning.search_rate");
    for (let i = 2; i < SEARCH_PER_LEASE; i++) {
      h.advance(LEASE_SEARCH_SPACING_MS);
      expect((await h.call(SEARCH_PATH)).status, `search ${i + 1}`).toBe(200);
    }
    h.advance(LEASE_SEARCH_SPACING_MS);
    expect(await ruleOf(await h.call(SEARCH_PATH))).toBe("provisioning.search_cap");
    expect(searches(h)).toBe(SEARCH_PER_LEASE);
  });

  it("starts a new lease's count afresh", async () => {
    const h = await ready();
    const first = await signUpLease(h);
    for (let i = 0; i < SEARCH_PER_LEASE; i++) {
      expect((await h.call(SEARCH_PATH)).status).toBe(200);
      h.advance(LEASE_SEARCH_SPACING_MS);
    }
    expect(await ruleOf(await h.call(SEARCH_PATH))).toBe("provisioning.search_cap");
    await h.call(`/lease/${first}`, { method: "DELETE" });
    await signUpLease(h);
    expect((await h.call(SEARCH_PATH)).status).toBe(200);
  });

  it("never lets S32's lease order or change a standing number", async () => {
    const h = await ready();
    await signUpLease(h);
    await h.call("/partition", { caller: "rig-api" });
    const before = await readTier(h.ctx);
    const lastOrder = await h.store.get(ORDER_KEYS.last);
    expect(await ruleOf(await order(h))).toBe("provisioning.order_needs_lease");
    expect(await h.store.get(ORDER_KEYS.last)).toEqual(lastOrder);
    expect((await readTier(h.ctx)).month_to_date_usd).toBe(before.month_to_date_usd);
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-devw1", { method: "PATCH", body: { customer_reference: "x" } }))).toBe(
      "provisioning.number_standing",
    );
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-devw1", { method: "DELETE" }))).toBe("provisioning.number_standing");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toEqual([]);
    expect(h.telnyx.writes()).toEqual([]);
  });
});

describe("number orders", () => {
  it("stays off until production reports the partition rule", async () => {
    const h = await ready();
    await lease(h, "S28", "rig-api");
    h.production.capabilities = [];
    expect(await ruleOf(await order(h))).toBe("provisioning.ordering_off");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toEqual([]);
  });

  it("waits for paid dials, since its number is bound to the voice app and takes inbound calls", async () => {
    for (const env of [{ TELNYX_CONCURRENT_FLOOR: "unknown" }, {}]) {
      const h = await ready({ env, validated: null });
      await lease(h, "S28", "rig-api");
      expect(await ruleOf(await order(h))).toBe("provisioning.voice_closed");
      expect(h.telnyx.requests("POST", "/v2/number_orders")).toEqual([]);
    }
  });

  it("needs the S28 lease", async () => {
    const h = await ready();
    expect(await ruleOf(await order(h))).toBe("provisioning.order_needs_lease");
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

  it("refuses an order outside the partition", async () => {
    const h = await ready();
    await lease(h, "S28", "rig-api");
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
    for (const [body, rule] of cases) expect(await ruleOf(await order(h, body)), JSON.stringify(body)).toBe(rule);
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toEqual([]);
  });

  it("orders at most once every 25 days", async () => {
    const h = await ready();
    await lease(h, "S28", "rig-api");
    expect((await order(h)).status).toBe(200);
    h.advance(20 * 60 * 1000);
    await lease(h, "S28", "rig-api");
    expect(await ruleOf(await order(h, { phone_numbers: [{ phone_number: "+14165550151" }] }))).toBe(
      "provisioning.order_interval",
    );
  });

  it("holds at most ten numbers", async () => {
    const h = await ready();
    for (let i = 0; i < 3; i++) {
      h.telnyx.numbers.push({
        id: `num-extra-${i}`,
        phone_number: `+1416555017${i}`,
        billing_group_id: "bg-nonprod",
        connection_id: "conn-voice",
        messaging_profile_id: "prof-qa-c",
        tags: [],
      });
    }
    await h.store.delete("partition:owned");
    await lease(h, "S28", "rig-api");
    expect(await ruleOf(await order(h))).toBe("provisioning.numbers_held");
  });

  it("counts a standing number Telnyx has not listed yet toward the ten", async () => {
    const h = await ready();
    for (let i = 0; i < 2; i++) {
      h.telnyx.numbers.push({ id: `num-extra-${i}`, phone_number: `+1416555017${i}`, billing_group_id: "bg-nonprod", connection_id: "conn-voice", messaging_profile_id: "prof-qa-c", tags: [] });
    }
    await h.store.delete("partition:owned");
    await lease(h, "S28", "rig-api");
    await h.store.put("partition:standing", { "DEV-E1": { role: "DEV-E1", phone_number: "+14165550179" } });
    expect(await ruleOf(await order(h))).toBe("provisioning.numbers_held");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toEqual([]);
  });

  it("refuses an order whose rental and reserve would take the month past its budget", async () => {
    const h = await ready();
    await lease(h, "S28", "rig-api");
    await h.call("/partition", { caller: "rig-api" });
    const before = await readTier(h.ctx);
    await charge(h.ctx, before.usage_budget_usd - before.month_to_date_usd - 0.5);
    expect((await readTier(h.ctx)).tier).not.toBe("red");
    expect(await ruleOf(await order(h))).toBe("budget.tier_red");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toEqual([]);
  });

  it("orders while the month stays in budget with the number counted", async () => {
    const h = await ready();
    await lease(h, "S28", "rig-api");
    await h.call("/partition", { caller: "rig-api" });
    const before = await readTier(h.ctx);
    await charge(h.ctx, before.usage_budget_usd - before.month_to_date_usd - 5);
    expect((await order(h)).status).toBe(200);
  });

  it("stops ordering, deleting nothing, when the group did not stick", async () => {
    const h = await ready();
    h.telnyx.dropGroupOnOrder = true;
    await lease(h, "S28", "rig-api");
    expect((await order(h)).status).toBe(200);
    expect(await h.store.get(ORDER_KEYS.stopped)).toBeDefined();
    expect(h.telnyx.numbers.some((item) => item.phone_number === "+14165550150")).toBe(true);
    expect(h.telnyx.requests("DELETE")).toEqual([]);
    const event = h.outbound.find((item) => item.url.includes("/envelope/"));
    expect(event?.body).toContain('"fingerprint":["ops","telnyx-guard-order-group"]');
    // The number is still in the account, bound to nonprod resources with no group: the start-up check now reads that as unsafe.
    h.advance(30 * DAY);
    await h.store.put("admission:reserve", { legs: 2, measured_at: h.clock.now });
    await lease(h, "S28", "rig-api");
    expect(await ruleOf(await order(h, { phone_numbers: [{ phone_number: "+14165550151" }] }))).toBe("startup.unsafe");
  });

  it("waits for the first order's read-back before ordering again", async () => {
    const h = await ready();
    await h.store.put(ORDER_KEYS.first, { state: "pending", order_id: null, phone_number: "+14165550159", at: h.clock.now });
    await lease(h, "S28", "rig-api");
    expect(await ruleOf(await order(h))).toBe("provisioning.ordering_off");
  });
});

describe("number changes", () => {
  it("patches and deletes only owned numbers that are not standing", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-prod", { method: "PATCH", body: { customer_reference: "x" } }))).toBe(
      "provisioning.number_not_owned",
    );
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-devw1", { method: "PATCH", body: { customer_reference: "x" } }))).toBe(
      "provisioning.number_standing",
    );
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-devw1", { method: "DELETE" }))).toBe(
      "provisioning.number_standing",
    );
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-prod", { method: "DELETE" }))).toBe(
      "provisioning.number_not_owned",
    );
    expect(h.telnyx.writes()).toEqual([]);

    expect((await h.call("/telnyx/v2/phone_numbers/num-scratch", { method: "PATCH", body: { connection_id: "conn-voice" } })).status).toBe(200);
    await h.store.delete("limit:validation");
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-scratch", { method: "PATCH", body: { connection_id: "conn-voice" } }))).toBe(
      "provisioning.voice_closed",
    );
    expect((await h.call("/telnyx/v2/phone_numbers/num-scratch", { method: "PATCH", body: { customer_reference: "x" } })).status).toBe(200);
    expect((await h.call("/telnyx/v2/phone_numbers/num-scratch", { method: "DELETE" })).status).toBe(200);
  });

  it("treats a number with the standing tag as standing even when the store forgot it", async () => {
    const h = await ready();
    await h.store.delete("partition:standing");
    expect(await ruleOf(await h.call("/telnyx/v2/phone_numbers/num-robot1", { method: "DELETE" }))).toBe(
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
      expect(await ruleOf(await patch(body)), JSON.stringify(body)).toBe("provisioning.patch_field");
    }
  });

  it("allows caller-name settings on a number's voice, and never forwarding", async () => {
    const h = await ready();
    const patch = (body: Record<string, unknown>) =>
      h.call("/telnyx/v2/phone_numbers/num-scratch/voice", { method: "PATCH", body });
    expect(await ruleOf(await patch({ call_forwarding: { call_forwarding_enabled: true, forwards_to: N.notOwned } }))).toBe(
      "provisioning.patch_field",
    );
    expect(await ruleOf(await patch({ translated_number: N.notOwned }))).toBe("provisioning.patch_field");
    expect((await patch({ caller_id_name_enabled: true })).status).toBe(200);
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

  it("needs a small daily limit, a US/CA whitelist and edge webhooks", async () => {
    const h = await ready();
    const cases: [Record<string, unknown>, string][] = [
      [{ daily_spend_limit: "0.07" }, "provisioning.profile_spend_limit"],
      [{ daily_spend_limit: undefined }, "provisioning.profile_spend_limit"],
      [{ daily_spend_limit_enabled: false }, "provisioning.profile_spend_limit"],
      [{ whitelisted_destinations: ["US", "GB"] }, "provisioning.profile_whitelist"],
      [{ whitelisted_destinations: [] }, "provisioning.profile_whitelist"],
      [{ webhook_url: "https://api.loonext.com/webhooks/telnyx" }, "provisioning.profile_webhook"],
      [{ webhook_failover_url: "https://somewhere.example" }, "provisioning.profile_webhook"],
    ];
    for (const [body, rule] of cases) expect(await ruleOf(await create(h, body)), JSON.stringify(body)).toBe(rule);
  });

  it("holds at most seven nonprod profiles, and counts the new one as nonprod", async () => {
    const h = await ready();
    const first = await create(h, {});
    expect(first.status).toBe(201);
    const id = ((await first.json()) as { data: { id: string } }).data.id;
    expect(await h.store.get<string[]>("partition:app-profiles")).toContain(id);
    expect(await ruleOf(await create(h, { name: "company-y" }))).toBe("provisioning.profile_count");
  });

  it("returns the new profile without its v1 secret", async () => {
    const h = await ready();
    const body = (await (await create(h, {})).json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ name: "company-x" });
    expect(body.data).not.toHaveProperty("v1_secret");
    expect(h.telnyx.lists.messaging_profiles.at(-1)).toHaveProperty("v1_secret");
  });
});

describe("telephony credentials", () => {
  it("creates credentials only on the rig's two credential connections", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call("/telnyx/v2/telephony_credentials", { body: { connection_id: "conn-prod-webrtc" } }))).toBe(
      "provisioning.credential_connection",
    );
    expect(await ruleOf(await h.call("/telnyx/v2/telephony_credentials", { body: { connection_id: "conn-voice" } }))).toBe(
      "provisioning.credential_connection",
    );
    const created = await h.call("/telnyx/v2/telephony_credentials", { body: { connection_id: "conn-webrtc", name: "m1" } });
    expect(created.status).toBe(201);
    const data = ((await created.json()) as { data: Record<string, unknown> }).data;
    expect(data.sip_username).toMatch(/^gencred/);
    expect(data).not.toHaveProperty("sip_password");
  });

  it("keeps the sentinel to one credential, counting what Telnyx holds", async () => {
    const h = await ready();
    const create = () => h.call("/telnyx/v2/telephony_credentials", { body: { connection_id: "conn-sentinel" } });
    expect(await ruleOf(await create())).toBe("provisioning.sentinel_full");
    h.telnyx.lists.telephony_credentials = h.telnyx.lists.telephony_credentials.filter((item) => item.id !== "cred-sentinel");
    expect((await create()).status).toBe(201);
    expect(await ruleOf(await create())).toBe("provisioning.sentinel_full");
  });

  it("caps creations at 50 a day", async () => {
    const h = await ready();
    await h.store.put("count:credentials:2026-11-02", 50);
    expect(await ruleOf(await h.call("/telnyx/v2/telephony_credentials", { body: { connection_id: "conn-webrtc" } }))).toBe(
      "budget.credentials_day",
    );
  });

  it("deletes and mints tokens only for nonprod credentials", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call("/telnyx/v2/telephony_credentials/cred-prod", { method: "DELETE" }))).toBe(
      "provisioning.credential_not_nonprod",
    );
    expect(await ruleOf(await h.call("/telnyx/v2/telephony_credentials/cred-prod/token", { method: "POST", body: {} }))).toBe(
      "provisioning.credential_not_nonprod",
    );
    const token = await h.call("/telnyx/v2/telephony_credentials/cred-owner/token", { method: "POST", body: {} });
    expect(token.status).toBe(201);
    expect(await token.text()).toBe("jwt-token-text");
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
    expect(await ruleOf(await dial())).toBe("dial.to_not_owned");
  });
});
