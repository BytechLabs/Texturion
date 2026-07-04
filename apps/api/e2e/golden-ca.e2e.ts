/**
 * D31 launch-pass — golden path 2: CA-only instant path.
 *
 * A Canadian company with `us_texting_enabled=false` owes NO US registration
 * (no wizard, no 10DLC brand/campaign). The whole spine is:
 *   seed a CA company (no messaging_registrations rows)
 *   → POST /v1/billing/checkout → 200 (Gate-2 is not in play — nothing owed)
 *   → register the subscription/customer, inject the signed paid
 *     checkout.session.completed → active, number provisions
 *   → a CA-destined send SUCCEEDS IMMEDIATELY (no registration gate blocks it),
 *     and getSendGates never demanded US approval.
 *
 * Fixed per-spec id space; afterAll tears it down.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startHarness, type Harness } from "./harness";

let h: Harness;

const OWNER_ID = "d31c0002-0001-4001-8001-000000000001";
const COMPANY_ID = "d31c0002-0002-4002-8002-000000000002";
const CA_CONTACT_ID = "d31c0002-0005-4005-8005-000000000005";
const CA_CONVERSATION_ID = "d31c0002-0007-4007-8007-000000000007";

const SUB_ID = "sub_e2e_ca_1";
const CUS_ID = "cus_e2e_ca_1";
const CHECKOUT_SESSION_ID = "cs_e2e_ca_golden_1";
const CHECKOUT_EVENT_ID = "evt_e2e_ca_checkout_1";

// CA SMS destination (NANP: 604 = BC/CA).
const CA_DEST = "+16045551234";

function registerStripeFixtures(): void {
  const nowSec = Math.floor(Date.now() / 1000);
  h.stripe.setCustomer(CUS_ID, {
    id: CUS_ID,
    object: "customer",
    email: `${h.runId}-owner@golden-ca.test`,
  });
  h.stripe.setSubscription(SUB_ID, {
    id: SUB_ID,
    object: "subscription",
    status: "active",
    cancel_at_period_end: false,
    schedule: null,
    items: {
      object: "list",
      data: [
        {
          id: "si_licensed",
          object: "subscription_item",
          quantity: 1,
          current_period_start: nowSec,
          current_period_end: nowSec + 30 * 24 * 3600,
          price: {
            id: h.env.STRIPE_STARTER_PRICE_ID as string,
            object: "price",
            recurring: { interval: "month" },
          },
        },
        {
          id: "si_metered",
          object: "subscription_item",
          current_period_start: nowSec,
          current_period_end: nowSec + 30 * 24 * 3600,
          price: {
            id: h.env.STRIPE_STARTER_OVERAGE_PRICE_ID as string,
            object: "price",
            recurring: { interval: "month", meter: "mtr_e2e" },
          },
        },
      ],
    },
  });
  // CA-only: no US-registration fee line (owesUsRegistration is false).
  h.stripe.setSessionLineItems(CHECKOUT_SESSION_ID, [
    { id: "li_1", price: { id: h.env.STRIPE_STARTER_PRICE_ID as string } },
  ]);
}

function checkoutCompletedEvent(): Record<string, unknown> {
  return {
    id: CHECKOUT_EVENT_ID,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: CHECKOUT_SESSION_ID,
        object: "checkout.session",
        mode: "subscription",
        payment_status: "paid",
        client_reference_id: COMPANY_ID,
        subscription: SUB_ID,
        customer: CUS_ID,
      },
    },
  };
}

beforeAll(async () => {
  h = await startHarness();
  cleanup();
  h.sql(`
    ${h.seedUserSql(OWNER_ID, `${h.runId}-owner@golden-ca.test`, "Casey Owner")}

    insert into public.companies
      (id, name, owner_user_id, country, us_texting_enabled, requested_area_code,
       subscription_status, aup_accepted_at)
    values ('${COMPANY_ID}', 'Northern HVAC', '${OWNER_ID}', 'CA', false, '604',
            'incomplete', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY_ID}', '${OWNER_ID}', 'owner');

    insert into public.contacts (id, company_id, phone_e164, name)
    values ('${CA_CONTACT_ID}', '${COMPANY_ID}', '${CA_DEST}', 'CA Customer');
  `);
  registerStripeFixtures();
});

afterAll(async () => {
  if (h) {
    cleanup();
    await h.close();
  }
});

function cleanup(): void {
  h.sql(`
    delete from public.messages where company_id = '${COMPANY_ID}';
    delete from public.conversations where company_id = '${COMPANY_ID}';
    delete from public.contacts where company_id = '${COMPANY_ID}';
    delete from public.messaging_registrations where company_id = '${COMPANY_ID}';
    delete from public.grace_notices where company_id = '${COMPANY_ID}';
    delete from public.webhook_events where event_id in ('${CHECKOUT_EVENT_ID}');
    delete from public.phone_numbers where company_id = '${COMPANY_ID}';
    delete from public.company_members where company_id = '${COMPANY_ID}';
    delete from public.companies where id = '${COMPANY_ID}';
    delete from public.profiles where user_id = '${OWNER_ID}';
    delete from auth.users where id = '${OWNER_ID}';
  `);
}

async function activeNumber(): Promise<{ id: string; number_e164: string } | null> {
  const { data } = await h.db
    .from("phone_numbers")
    .select("id,number_e164,status")
    .eq("company_id", COMPANY_ID)
    .eq("status", "active")
    .limit(1);
  const row = (data ?? [])[0] as
    | { id: string; number_e164: string; status: string }
    | undefined;
  return row ? { id: row.id, number_e164: row.number_e164 } : null;
}

describe("D31 golden path 2: CA-only instant path", () => {
  it("POST /v1/billing/checkout returns a url with no US-registration gate", async () => {
    const token = await h.token(OWNER_ID);
    const res = await h.call("POST", "/v1/billing/checkout", {
      token,
      companyId: COMPANY_ID,
      body: { plan: "starter" },
    });
    expect(res.status).toBe(200);
    expect((res.json as { url: string }).url).toMatch(
      /^https:\/\/checkout\.stripe\.test\//,
    );
  });

  it("paid checkout.session.completed activates and provisions a CA number", async () => {
    const res = await h.injectStripe(checkoutCompletedEvent());
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ received: true });

    const { data } = await h.db
      .from("companies")
      .select("subscription_status,plan")
      .eq("id", COMPANY_ID)
      .limit(1);
    const company = (data ?? [])[0] as {
      subscription_status: string;
      plan: string | null;
    };
    expect(company.subscription_status).toBe("active");
    expect(company.plan).toBe("starter");

    // One number ordered + activated. No 10DLC brand/campaign submission at all
    // (a CA company with US texting off owes no registration).
    expect(h.telnyx.callsTo("POST", /\/v2\/number_orders$/)).toHaveLength(1);
    expect(h.telnyx.callsTo("POST", /\/v2\/10dlc\/brand$/)).toHaveLength(0);
    expect(h.telnyx.callsTo("POST", /\/v2\/10dlc\/campaignBuilder$/)).toHaveLength(0);

    const number = await activeNumber();
    expect(number).not.toBeNull();

    // Wire the number into the seeded conversation for the send below.
    h.sql(`
      insert into public.conversations
        (id, company_id, contact_id, phone_number_id, status)
      values ('${CA_CONVERSATION_ID}', '${COMPANY_ID}', '${CA_CONTACT_ID}',
              '${number?.id}', 'open');
    `);
  });

  it("a CA-destined send SUCCEEDS IMMEDIATELY — no US-registration gate blocks it", async () => {
    const token = await h.token(OWNER_ID);
    const before = h.telnyx.callsTo("POST", /\/v2\/messages$/).length;

    const res = await h.call("POST", "/v1/messages/send", {
      token,
      companyId: COMPANY_ID,
      idempotencyKey: `${h.runId}-ca-instant-1`,
      body: { conversation_id: CA_CONVERSATION_ID, body: "Booking confirmed for Tuesday." },
    });
    expect(res.status).toBe(201);
    // The send reached (fake) Telnyx exactly once — CA has no registration gate.
    expect(h.telnyx.callsTo("POST", /\/v2\/messages$/)).toHaveLength(before + 1);

    // Belt-and-braces: the persisted row carries a telnyx_message_id (accepted).
    const { data } = await h.db
      .from("messages")
      .select("direction,status,telnyx_message_id")
      .eq("company_id", COMPANY_ID)
      .eq("direction", "outbound");
    expect(data ?? []).toHaveLength(1);
    expect((data ?? [])[0]).toMatchObject({ direction: "outbound" });
    expect((data ?? [])[0]?.telnyx_message_id).toBeTruthy();
  });
});
