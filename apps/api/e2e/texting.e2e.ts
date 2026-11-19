import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deleteCompaniesSql } from "./company-cleanup";
import { startHarness } from "./harness";
import type { Harness } from "./harness";

const OWNER = "d31c0812-0001-4001-8001-000000000001";
const COMPANY = "d31c0812-0002-4002-8002-000000000002";
const LINE = "d31c0812-0003-4003-8003-000000000003";
const CONTACT = "d31c0812-0004-4004-8004-000000000004";
const THREAD = "d31c0812-0005-4005-8005-000000000005";
const LINE_PHONE = "+16045550182";
const CONTACT_PHONE = "+16045550183";
const STRIPE_CUSTOMER = "cus_e2e_texting_812";

let h: Harness;
let token: string;
let sequence = 0;

function cleanup(): void {
  h.sql(`
    delete from public.webhook_events
    where provider = 'telnyx' and event_id like 'texting-${h.runId}-%';
    ${deleteCompaniesSql([COMPANY])}
    delete from public.profiles where user_id = '${OWNER}';
    delete from auth.users where id = '${OWNER}';
  `);
}

beforeAll(async () => {
  h = await startHarness();
});

beforeEach(async () => {
  cleanup();
  h.sql(`
    ${h.seedUserSql(OWNER, `${h.runId}-owner@texting.test`, "Texting Owner")}

    insert into public.companies
      (id, name, owner_user_id, country, us_texting_enabled, requested_area_code,
       subscription_status, plan, stripe_customer_id, current_period_start,
       current_period_end, aup_accepted_at)
    values ('${COMPANY}', 'Coastal Plumbing', '${OWNER}', 'CA', false, '604',
      'active', 'starter', '${STRIPE_CUSTOMER}', now(), now() + interval '30 days', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY}', '${OWNER}', 'owner');

    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, number_e164)
    values ('${LINE}', '${COMPANY}', 'active', 'texting-${h.runId}', 'CA', '${LINE_PHONE}');

    insert into public.contacts (id, company_id, phone_e164, name)
    values ('${CONTACT}', '${COMPANY}', '${CONTACT_PHONE}', 'Texting Customer');

    insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
    values ('${THREAD}', '${COMPANY}', '${CONTACT}', '${LINE}', 'open');
  `);
  token = await h.token(OWNER);
});

afterAll(async () => {
  if (!h) return;
  try {
    cleanup();
  } finally {
    await h.close();
  }
});

function fixtureId(): string {
  sequence += 1;
  return `texting-${h.runId}-${sequence}`;
}

function send() {
  return h.call("POST", "/v1/messages/send", {
    token,
    companyId: COMPANY,
    idempotencyKey: fixtureId(),
    body: { conversation_id: THREAD, body: "The crew can come Tuesday." },
  });
}

async function outbound() {
  const result = await h.db
    .from("messages")
    .select("id, telnyx_message_id, status, segments, error_code")
    .eq("company_id", COMPANY)
    .eq("direction", "outbound")
    .single();
  expect(result.error).toBeNull();
  if (!result.data?.telnyx_message_id) throw new Error("Outbound message has no Telnyx ID");
  return result.data;
}

function receipt(id: string, status: "delivered" | "delivery_failed") {
  return {
    data: {
      id: fixtureId(),
      event_type: "message.finalized",
      occurred_at: new Date().toISOString(),
      payload: {
        id,
        type: "SMS",
        direction: "outbound",
        parts: 2,
        encoding: "GSM-7",
        cost: { amount: "0.0080", currency: "USD" },
        to: [{ phone_number: CONTACT_PHONE, status }],
        errors: status === "delivery_failed" ? [{ code: "40300", title: "Opted out" }] : [],
      },
    },
  };
}

async function deliver(event: unknown) {
  const result = await h.injectTelnyx(event);
  expect(result.status, result.text).toBe(200);
}

function inbound(keyword: string) {
  const now = new Date().toISOString();
  return deliver({
    data: {
      id: fixtureId(),
      event_type: "message.received",
      occurred_at: now,
      payload: {
        id: fixtureId(),
        type: "SMS",
        direction: "inbound",
        from: { phone_number: CONTACT_PHONE },
        to: [{ phone_number: LINE_PHONE, status: "webhook_delivered" }],
        text: keyword,
        media: [],
        received_at: now,
        encoding: "GSM-7",
        parts: 1,
      },
    },
  });
}

async function optOut() {
  const result = await h.db
    .from("opt_outs")
    .select("source,revoked_at")
    .eq("company_id", COMPANY)
    .eq("phone_e164", CONTACT_PHONE)
    .maybeSingle();
  expect(result.error).toBeNull();
  return result.data;
}

async function expectBilledOnce(messageId: string, carrierId: string) {
  const usage = await h.db
    .from("usage_events")
    .select("quantity, meter_identifier, stripe_reported_at")
    .eq("company_id", COMPANY)
    .eq("message_id", messageId);
  expect(usage.error).toBeNull();
  expect(usage.data).toEqual([
    { quantity: 2, meter_identifier: carrierId, stripe_reported_at: expect.any(String) },
  ]);
  const meterCalls = h.stripe.callsTo("POST", /\/v1\/billing\/meter_events$/)
    .filter(({ form }) => form.get("identifier") === carrierId);
  expect(meterCalls).toHaveLength(1);
  expect(meterCalls[0].form.get("payload[stripe_customer_id]")).toBe(STRIPE_CUSTOMER);
}

describe("texting through the Worker and Supabase", () => {
  it.each([
    ["delivered", "delivered", null],
    ["delivery_failed", "failed", "40300"],
  ] as const)(
    "persists %s receipts once even when the sent event arrives late",
    async (carrierStatus, status, errorCode) => {
      expect((await send()).status).toBe(201);
      const { id, telnyx_message_id: carrierId } = await outbound();
      const finalized = receipt(carrierId, carrierStatus);

      await deliver(finalized);
      await deliver({
        data: { event_type: "message.sent", id: fixtureId(), payload: { id: carrierId } },
      });
      await deliver(finalized);
      await deliver(receipt(carrierId, carrierStatus));

      await expect(outbound()).resolves.toMatchObject({ status, error_code: errorCode, segments: 2 });
      await expectBilledOnce(id, carrierId);
    },
  );

  it.each(["STOP", "ARRET"])("%s blocks the next send until the customer texts START", async (keyword) => {
    await inbound(keyword);
    await expect(optOut()).resolves.toEqual({ source: "stop_keyword", revoked_at: null });

    const before = h.telnyx.callsTo("POST", /\/v2\/messages$/).length;
    const sendWhileBlocked = await send();
    expect(sendWhileBlocked.status).toBe(403);
    expect(sendWhileBlocked.json).toMatchObject({ error: { code: "recipient_opted_out" } });
    expect(h.telnyx.callsTo("POST", /\/v2\/messages$/)).toHaveLength(before);

    const lift = await h.call("POST", `/v1/contacts/${CONTACT}/opt-out/revoke`, {
      token,
      companyId: COMPANY,
    });
    expect(lift.status).toBe(409);
    await expect(optOut()).resolves.toEqual({ source: "stop_keyword", revoked_at: null });

    await inbound("START");
    await expect(optOut()).resolves.toEqual({ source: "stop_keyword", revoked_at: expect.any(String) });
    expect((await send()).status).toBe(201);
    expect(h.telnyx.callsTo("POST", /\/v2\/messages$/)).toHaveLength(before + 1);
  });

  it("keeps a bare YES as an ordinary message when no opt-out is active", async () => {
    await inbound("YES");
    await expect(optOut()).resolves.toBeNull();
    const message = await h.db
      .from("messages")
      .select("body")
      .eq("company_id", COMPANY)
      .eq("direction", "inbound")
      .single();
    expect(message.error).toBeNull();
    expect(message.data).toEqual({ body: "YES" });
    const revocations = await h.db
      .from("conversation_events")
      .select("id")
      .eq("company_id", COMPANY)
      .eq("type", "opt_out_revoked");
    expect(revocations.error).toBeNull();
    expect(revocations.data).toEqual([]);
  });
});
