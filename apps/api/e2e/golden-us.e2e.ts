/**
 * D31 launch-pass — golden path 1: US sole-prop full spine.
 *
 * The load-bearing cross-vendor sequence step 19 names for a US company:
 *   seed a US company + a submittable sole-prop brand + campaign draft
 *     (messaging_registrations, the exact §4.4 wizard keys so the checkout
 *      Gate-2 registration-draft-complete check passes)
 *   → POST /v1/billing/checkout → 200 with a Stripe checkout url
 *   → register the subscription + customer fixtures, inject a signed paid
 *     checkout.session.completed → company flips 'active', number provisions,
 *     the sole-prop 10DLC brand submits (+ the OTP is triggered)
 *   → DUPLICATE-DELIVERY of the SAME event: still active, number ordered
 *     EXACTLY ONCE (the provisioning_key backstop)
 *   → GATE: a US-destined send is BLOCKED (registration_pending) while a
 *     CA-destined send SUCCEEDS (no US-registration gate on CA)
 *   → drive the OTP verify + the brand-approval webhook → the campaign submits;
 *     inject the campaign-approval webhook → US texting unlocks
 *   → the same US-destined send NOW SUCCEEDS (one more POST /v2/messages).
 *
 * Everything is scoped to a fixed per-spec UUID set; afterAll tears it down.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startHarness, type Harness } from "./harness";

let h: Harness;

// Fixed per-spec id space (cleaned in afterAll; the DB starts empty).
const OWNER_ID = "d31c0001-0001-4001-8001-000000000001";
const COMPANY_ID = "d31c0001-0002-4002-8002-000000000002";
const BRAND_ID = "d31c0001-0003-4003-8003-000000000003";
const CAMPAIGN_ID = "d31c0001-0004-4004-8004-000000000004";
const US_CONTACT_ID = "d31c0001-0005-4005-8005-000000000005";
const CA_CONTACT_ID = "d31c0001-0006-4006-8006-000000000006";
const US_CONVERSATION_ID = "d31c0001-0007-4007-8007-000000000007";
const CA_CONVERSATION_ID = "d31c0001-0008-4008-8008-000000000008";

// Stripe fixture ids the paid webhook references.
const SUB_ID = "sub_e2e_us_1";
const CUS_ID = "cus_e2e_us_1";
const CHECKOUT_SESSION_ID = "cs_e2e_us_golden_1";
const CHECKOUT_EVENT_ID = "evt_e2e_us_checkout_1";

// US + CA SMS destinations (NANP: 212 = NY/US, 514 = QC/CA).
const US_DEST = "+12125551234";
const CA_DEST = "+15145559876";

// The §4.4 sole-prop brand draft, stored under the canonical Telnyx keys the
// checkout Gate-2 (billing/registration-draft) and submitBrand both read.
const BRAND_DRAFT = {
  displayName: "Pats Plumbing",
  firstName: "Pat",
  lastName: "Rivera",
  ein: "1234", // last-4 identifier (sole prop, §4.4)
  mobilePhone: "+12125550111",
  email: "pat@patsplumbing.test",
  phone: "+12125550100",
  vertical: "PROFESSIONAL",
  street: "1 Main St",
  city: "New York",
  state: "NY",
  postalCode: "10001",
  country: "US",
};

const CAMPAIGN_DRAFT = {
  messageFlow:
    "Customers text our business number first, or ask us in person / by phone to text them. We never send marketing blasts.",
  sample1:
    "Hi, this is Pats Plumbing — we can come Tuesday at 3pm, does that work for you?",
  sample2:
    "Your appointment is confirmed for tomorrow at 9am. Reply STOP to opt out.",
};

/** Register the Stripe subscription + customer the paid webhook re-fetches. */
function registerStripeFixtures(): void {
  const nowSec = Math.floor(Date.now() / 1000);
  h.stripe.setCustomer(CUS_ID, {
    id: CUS_ID,
    object: "customer",
    email: `${h.runId}-owner@golden-us.test`,
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
          // Maps to plan 'starter' via env.STRIPE_STARTER_PRICE_ID.
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
  // The paid webhook lists this session's line items to decide the $29 fee
  // stamp — include the US-fee price so the fee-stamp branch is exercised.
  h.stripe.setSessionLineItems(CHECKOUT_SESSION_ID, [
    { id: "li_1", price: { id: h.env.STRIPE_STARTER_PRICE_ID as string } },
    { id: "li_2", price: { id: h.env.STRIPE_US_FEE_PRICE_ID as string } },
  ]);
}

/** The signed paid checkout event (re-used to prove duplicate-delivery). */
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
    ${h.seedUserSql(OWNER_ID, `${h.runId}-owner@golden-us.test`, "Pat Rivera")}

    insert into public.companies
      (id, name, owner_user_id, country, us_texting_enabled, requested_area_code,
       subscription_status, aup_accepted_at)
    values ('${COMPANY_ID}', 'Pats Plumbing', '${OWNER_ID}', 'US', true, '212',
            'incomplete', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY_ID}', '${OWNER_ID}', 'owner');

    -- Submittable sole-prop brand + campaign drafts (checkout Gate-2).
    insert into public.messaging_registrations
      (id, company_id, kind, status, sole_proprietor, data)
    values
      ('${BRAND_ID}', '${COMPANY_ID}', 'brand', 'draft', true,
       '${JSON.stringify(BRAND_DRAFT)}'::jsonb),
      ('${CAMPAIGN_ID}', '${COMPANY_ID}', 'campaign', 'draft', false,
       '${JSON.stringify(CAMPAIGN_DRAFT)}'::jsonb);

    -- Two contacts + open conversations: one US destination, one CA. The
    -- conversation's phone_number_id is filled in after provisioning below.
    insert into public.contacts (id, company_id, phone_e164, name)
    values
      ('${US_CONTACT_ID}', '${COMPANY_ID}', '${US_DEST}', 'US Customer'),
      ('${CA_CONTACT_ID}', '${COMPANY_ID}', '${CA_DEST}', 'CA Customer');
  `);
  registerStripeFixtures();
});

afterAll(async () => {
  if (h) {
    cleanup();
    await h.close();
  }
});

/** Delete this spec's fixtures (children first for the FK restrict). */
function cleanup(): void {
  h.sql(`
    delete from public.messages where company_id = '${COMPANY_ID}';
    delete from public.conversations where company_id = '${COMPANY_ID}';
    delete from public.contacts where company_id = '${COMPANY_ID}';
    delete from public.messaging_registrations where company_id = '${COMPANY_ID}';
    delete from public.grace_notices where company_id = '${COMPANY_ID}';
    delete from public.webhook_events where event_id in
      ('${CHECKOUT_EVENT_ID}');
    delete from public.phone_numbers where company_id = '${COMPANY_ID}';
    delete from public.company_members where company_id = '${COMPANY_ID}';
    delete from public.companies where id = '${COMPANY_ID}';
    delete from public.profiles where user_id = '${OWNER_ID}';
    delete from auth.users where id = '${OWNER_ID}';
  `);
}

/** The company's active provisioned number, or null while still provisioning. */
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

async function companyStatus(): Promise<{
  subscription_status: string;
  plan: string | null;
  registration_fee_paid_at: string | null;
}> {
  const { data } = await h.db
    .from("companies")
    .select("subscription_status,plan,registration_fee_paid_at")
    .eq("id", COMPANY_ID)
    .limit(1);
  return (data ?? [])[0] as {
    subscription_status: string;
    plan: string | null;
    registration_fee_paid_at: string | null;
  };
}

async function registrationRow(
  kind: "brand" | "campaign",
): Promise<{ status: string; telnyx_id: string | null }> {
  const { data } = await h.db
    .from("messaging_registrations")
    .select("status,telnyx_id")
    .eq("company_id", COMPANY_ID)
    .eq("kind", kind)
    .limit(1);
  return (data ?? [])[0] as { status: string; telnyx_id: string | null };
}

describe("D31 golden path 1: US sole-prop full spine", () => {
  it("POST /v1/billing/checkout returns a Stripe checkout url", async () => {
    const token = await h.token(OWNER_ID);
    const res = await h.call("POST", "/v1/billing/checkout", {
      token,
      companyId: COMPANY_ID,
      body: { plan: "starter" },
    });
    expect(res.status).toBe(200);
    const body = res.json as { url: string };
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    // A subscription checkout session was created at (fake) Stripe.
    expect(h.stripe.callsTo("POST", /\/v1\/checkout\/sessions$/)).toHaveLength(1);
  });

  it("paid checkout.session.completed: active, number provisions, sole-prop brand submits + OTP", async () => {
    const res = await h.injectStripe(checkoutCompletedEvent());
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ received: true });

    // Company flipped active + plan mirrored from the licensed price; the $29
    // US-registration fee line was present, so the fee is stamped.
    const company = await companyStatus();
    expect(company.subscription_status).toBe("active");
    expect(company.plan).toBe("starter");
    expect(company.registration_fee_paid_at).not.toBeNull();

    // The number-order saga bought exactly one number and activated the row.
    expect(h.telnyx.callsTo("POST", /\/v2\/number_orders$/)).toHaveLength(1);
    const number = await activeNumber();
    expect(number).not.toBeNull();
    expect(number?.number_e164).toMatch(/^\+1\d{10}$/);

    // Sole-prop 10DLC brand submitted (+ the OTP text was triggered §4.2).
    expect(h.telnyx.callsTo("POST", /\/v2\/10dlc\/brand$/)).toHaveLength(1);
    expect(h.telnyx.callsTo("POST", /\/v2\/10dlc\/brand\/[^/]+\/smsOtp$/)).toHaveLength(1);
    const brand = await registrationRow("brand");
    expect(brand.status).toBe("submitted");
    expect(brand.telnyx_id).toBeTruthy();
    // The campaign waits for brand approval — still a draft, no Telnyx id yet.
    const campaign = await registrationRow("campaign");
    expect(campaign.status).toBe("draft");
    expect(campaign.telnyx_id).toBeNull();

    // Wire the provisioned number into both seeded conversations now that it
    // exists (the route loads the number off the conversation).
    h.sql(`
      insert into public.conversations
        (id, company_id, contact_id, phone_number_id, status)
      values
        ('${US_CONVERSATION_ID}', '${COMPANY_ID}', '${US_CONTACT_ID}',
         '${number?.id}', 'open'),
        ('${CA_CONVERSATION_ID}', '${COMPANY_ID}', '${CA_CONTACT_ID}',
         '${number?.id}', 'open');
    `);
  });

  it("DUPLICATE delivery of the same event: still active, number ordered exactly once", async () => {
    const res = await h.injectStripe(checkoutCompletedEvent());
    expect(res.status).toBe(200);
    // The webhook_events ledger dedupes → duplicate ack, no reprocessing.
    expect(res.json).toMatchObject({ received: true, duplicate: true });

    const company = await companyStatus();
    expect(company.subscription_status).toBe("active");
    // The number-order saga did NOT buy a second number.
    expect(h.telnyx.callsTo("POST", /\/v2\/number_orders$/)).toHaveLength(1);
    const { data } = await h.db
      .from("phone_numbers")
      .select("id")
      .eq("company_id", COMPANY_ID)
      .neq("status", "released");
    expect(data ?? []).toHaveLength(1);
  });

  it("GATE: a US-destined send is blocked (registration_pending); a CA-destined send succeeds", async () => {
    const token = await h.token(OWNER_ID);
    const before = h.telnyx.callsTo("POST", /\/v2\/messages$/).length;

    // US destination: campaign not yet approved → registration_pending (403).
    const usRes = await h.call("POST", "/v1/messages/send", {
      token,
      companyId: COMPANY_ID,
      idempotencyKey: `${h.runId}-us-blocked-1`,
      body: { conversation_id: US_CONVERSATION_ID, body: "Hi from Pats Plumbing" },
    });
    expect(usRes.status).toBe(403);
    expect((usRes.json as { error: { code: string } }).error.code).toBe(
      "registration_pending",
    );
    // No Telnyx send happened for the blocked US message.
    expect(h.telnyx.callsTo("POST", /\/v2\/messages$/)).toHaveLength(before);

    // CA destination: no US-registration gate → succeeds immediately.
    const caRes = await h.call("POST", "/v1/messages/send", {
      token,
      companyId: COMPANY_ID,
      idempotencyKey: `${h.runId}-ca-ok-1`,
      body: { conversation_id: CA_CONVERSATION_ID, body: "Hi from Pats Plumbing" },
    });
    expect(caRes.status).toBe(201);
    expect(h.telnyx.callsTo("POST", /\/v2\/messages$/)).toHaveLength(before + 1);
  });

  it("APPROVE: OTP verify + brand approval submit the campaign; campaign approval unlocks US sends", async () => {
    const brand = await registrationRow("brand");
    const brandTelnyxId = brand.telnyx_id as string;

    // Sole-prop OTP verify (§4.2): the wizard's PUT /v1/registration/otp path.
    // The fake accepts any PIN; this proves the OTP step is on the wire.
    const token = await h.token(OWNER_ID);
    const otpRes = await h.call("POST", "/v1/registration/otp", {
      token,
      companyId: COMPANY_ID,
      body: { code: "123456" },
    });
    // Route accepts the verify (200): the fake accepts any PIN on the PUT, so
    // the OTP step is proven on the wire. The brand-approval webhook below is
    // the authoritative driver that flips the row to approved.
    expect(otpRes.status).toBe(200);
    expect(
      h.telnyx.callsTo("PUT", new RegExp(`/v2/10dlc/brand/${brandTelnyxId}/smsOtp$`)),
    ).toHaveLength(1);

    // Brand approval webhook → R2 submits the campaign (campaignBuilder).
    await h.injectTelnyx({
      data: {
        event_type: "10dlc.brand.update",
        id: `${h.runId}-brand-approved`,
        payload: { brandId: brandTelnyxId, identityStatus: "VERIFIED" },
      },
    });
    expect(h.telnyx.callsTo("POST", /\/v2\/10dlc\/campaignBuilder$/)).toHaveLength(1);
    const campaign = await registrationRow("campaign");
    expect(campaign.status).toBe("submitted");
    const campaignTelnyxId = campaign.telnyx_id as string;
    expect(campaignTelnyxId).toBeTruthy();

    // Campaign approval webhook (MNO review accepted) → approved → US unlocks.
    await h.injectTelnyx({
      data: {
        event_type: "10dlc.campaign.update",
        id: `${h.runId}-campaign-approved`,
        payload: {
          campaignId: campaignTelnyxId,
          type: "MNO_REVIEW",
          status: "ACCEPTED",
        },
      },
    });
    const approvedCampaign = await registrationRow("campaign");
    expect(approvedCampaign.status).toBe("approved");

    // The SAME US-destined send now succeeds (one more POST /v2/messages).
    const before = h.telnyx.callsTo("POST", /\/v2\/messages$/).length;
    const usRes = await h.call("POST", "/v1/messages/send", {
      token,
      companyId: COMPANY_ID,
      idempotencyKey: `${h.runId}-us-ok-1`,
      body: { conversation_id: US_CONVERSATION_ID, body: "Hi from Pats Plumbing" },
    });
    expect(usRes.status).toBe(201);
    expect(h.telnyx.callsTo("POST", /\/v2\/messages$/)).toHaveLength(before + 1);
  });
});
