/**
 * D31 launch-pass — golden path 3: cancel → grace → release.
 *
 * Starts from a fully live company (active subscription, one active provisioned
 * number that owns a Telnyx resource id, one approved live 10DLC campaign):
 *   inject a signed customer.subscription.deleted → status 'canceled',
 *     canceled_at stamped from the event, numbers 'suspended', the day-1 grace
 *     warning captured in h.emails and recorded in the grace_notices ledger
 *   → resubscribe-within-grace (cheap): a fresh paid checkout.session.completed
 *     flips the company back to 'active' and UN-SUSPENDS the number without
 *     re-ordering (order count unchanged)
 *   → cancel again, then run the grace cron on a clock wound 31 days past
 *     cancellation → the number is RELEASED (row status 'released' AND a
 *     DELETE /v2/phone_numbers recorded) and the campaign DEACTIVATED
 *     (DELETE /v2/10dlc/campaign recorded).
 *
 * runGraceJob is imported and driven with an injected Date (its clock is a
 * parameter), exactly as the §11 scheduled handler passes the trigger time.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runGraceJob } from "../src/billing/grace";
import { getEnv } from "../src/env";
import { startHarness, type Harness } from "./harness";

let h: Harness;

const OWNER_ID = "d31c0003-0001-4001-8001-000000000001";
const COMPANY_ID = "d31c0003-0002-4002-8002-000000000002";
const NUMBER_ID = "d31c0003-0003-4003-8003-000000000003";
const BRAND_ID = "d31c0003-0004-4004-8004-000000000004";
const CAMPAIGN_ID = "d31c0003-0005-4005-8005-000000000005";

const SUB_ID = "sub_e2e_life_1";
const CUS_ID = "cus_e2e_life_1";
const TELNYX_PN_ID = "pn-e2e-life-1";
const CAMPAIGN_TELNYX_ID = "campaign-e2e-life-1";
const NUMBER_E164 = "+16135550142";

const DELETE_EVENT_ID = "evt_e2e_life_deleted_1";
const RESUB_SESSION_ID = "cs_e2e_life_resub_1";
const RESUB_EVENT_ID = "evt_e2e_life_resub_1";
const SECOND_DELETE_EVENT_ID = "evt_e2e_life_deleted_2";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A subscription object the deleted/resub webhooks reference. */
function subscriptionObject(): Record<string, unknown> {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
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
  };
}

/** A signed customer.subscription.deleted event (created = the cancel time). */
function subscriptionDeletedEvent(
  eventId: string,
  createdSec: number,
): Record<string, unknown> {
  return {
    id: eventId,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: createdSec,
    type: "customer.subscription.deleted",
    data: { object: { ...subscriptionObject(), status: "canceled" } },
  };
}

function resubCheckoutEvent(): Record<string, unknown> {
  return {
    id: RESUB_EVENT_ID,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: RESUB_SESSION_ID,
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
    ${h.seedUserSql(OWNER_ID, `${h.runId}-owner@lifecycle.test`, "Lifecycle Owner")}

    insert into public.companies
      (id, name, owner_user_id, country, us_texting_enabled, requested_area_code,
       subscription_status, plan, stripe_customer_id, stripe_subscription_id,
       current_period_start, current_period_end, aup_accepted_at)
    values ('${COMPANY_ID}', 'Riverside Roofing', '${OWNER_ID}', 'US', true, '613',
            'active', 'starter', '${CUS_ID}', '${SUB_ID}',
            now(), now() + interval '30 days', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY_ID}', '${OWNER_ID}', 'owner');

    -- A live provisioned number that owns a Telnyx resource id (so release
    -- issues DELETE /v2/phone_numbers/{id}).
    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, number_e164,
       telnyx_phone_number_id)
    values ('${NUMBER_ID}', '${COMPANY_ID}', 'active', 'life_${h.runId}',
            'US', '${NUMBER_E164}', '${TELNYX_PN_ID}');

    -- An approved, live 10DLC campaign (+ its brand) so grace-expiry
    -- deactivation issues DELETE /v2/10dlc/campaign/{id}.
    insert into public.messaging_registrations
      (id, company_id, kind, status, telnyx_id, approved_at)
    values
      ('${BRAND_ID}', '${COMPANY_ID}', 'brand', 'approved', 'brand-e2e-life-1', now()),
      ('${CAMPAIGN_ID}', '${COMPANY_ID}', 'campaign', 'approved', '${CAMPAIGN_TELNYX_ID}', now());
  `);
  h.stripe.setCustomer(CUS_ID, {
    id: CUS_ID,
    object: "customer",
    email: `${h.runId}-owner@lifecycle.test`,
  });
  h.stripe.setSubscription(SUB_ID, subscriptionObject());
  // The resubscribe checkout lists no US-fee line (already active before).
  h.stripe.setSessionLineItems(RESUB_SESSION_ID, [
    { id: "li_1", price: { id: h.env.STRIPE_STARTER_PRICE_ID as string } },
  ]);
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
    delete from public.webhook_events where event_id in
      ('${DELETE_EVENT_ID}', '${RESUB_EVENT_ID}', '${SECOND_DELETE_EVENT_ID}');
    delete from public.phone_numbers where company_id = '${COMPANY_ID}';
    delete from public.company_members where company_id = '${COMPANY_ID}';
    delete from public.companies where id = '${COMPANY_ID}';
    delete from public.profiles where user_id = '${OWNER_ID}';
    delete from auth.users where id = '${OWNER_ID}';
  `);
}

async function companyRow(): Promise<{
  subscription_status: string;
  canceled_at: string | null;
}> {
  const { data } = await h.db
    .from("companies")
    .select("subscription_status,canceled_at")
    .eq("id", COMPANY_ID)
    .limit(1);
  return (data ?? [])[0] as {
    subscription_status: string;
    canceled_at: string | null;
  };
}

async function numberRow(): Promise<{ status: string }> {
  const { data } = await h.db
    .from("phone_numbers")
    .select("status")
    .eq("id", NUMBER_ID)
    .limit(1);
  return (data ?? [])[0] as { status: string };
}

async function campaignRow(): Promise<{
  deactivated_at: string | null;
}> {
  const { data } = await h.db
    .from("messaging_registrations")
    .select("deactivated_at")
    .eq("id", CAMPAIGN_ID)
    .limit(1);
  return (data ?? [])[0] as { deactivated_at: string | null };
}

describe("D31 golden path 3: cancel → grace → release", () => {
  it("customer.subscription.deleted → canceled, numbers suspended, day-1 grace email", async () => {
    const canceledSec = Math.floor(Date.now() / 1000);
    const emailsBefore = h.emails.length;

    const res = await h.injectStripe(
      subscriptionDeletedEvent(DELETE_EVENT_ID, canceledSec),
    );
    expect(res.status).toBe(200);

    const company = await companyRow();
    expect(company.subscription_status).toBe("canceled");
    // canceled_at derives from the event's own timestamp (Postgres renders it
    // with a +00:00 offset; compare as instants, not string form).
    expect(new Date(company.canceled_at as string).getTime()).toBe(
      canceledSec * 1000,
    );

    // Numbers suspended (inbound still received; outbound blocked by the gate).
    expect((await numberRow()).status).toBe("suspended");

    // Day-1 grace warning: a ledger row + a captured email to the owner.
    const { data: notices } = await h.db
      .from("grace_notices")
      .select("threshold_day")
      .eq("company_id", COMPANY_ID);
    expect((notices ?? []).map((n) => (n as { threshold_day: number }).threshold_day)).toEqual([1]);

    const newEmails = h.emails.slice(emailsBefore);
    const graceEmail = newEmails.find((e) =>
      e.to.includes(`${h.runId}-owner@lifecycle.test`),
    );
    expect(graceEmail).toBeTruthy();
    expect(graceEmail?.subject).toMatch(/canceled/i);
  });

  it("resubscribe-within-grace: a fresh paid checkout flips back to active and un-suspends, NO re-order", async () => {
    const ordersBefore = h.telnyx.callsTo("POST", /\/v2\/number_orders$/).length;

    const res = await h.injectStripe(resubCheckoutEvent());
    expect(res.status).toBe(200);

    const company = await companyRow();
    expect(company.subscription_status).toBe("active");
    // The suspended number was un-suspended, not re-ordered.
    expect((await numberRow()).status).toBe("active");
    expect(h.telnyx.callsTo("POST", /\/v2\/number_orders$/)).toHaveLength(
      ordersBefore,
    );
    // Still exactly one non-released number row.
    const { data } = await h.db
      .from("phone_numbers")
      .select("id")
      .eq("company_id", COMPANY_ID)
      .neq("status", "released");
    expect(data ?? []).toHaveLength(1);
  });

  it("grace cron on a wound-forward clock (day 31): number RELEASED + campaign DEACTIVATED", async () => {
    // Cancel again so the grace clock starts, then run the cron 31 days later.
    const canceledSec = Math.floor(Date.now() / 1000);
    await h.injectStripe(
      subscriptionDeletedEvent(SECOND_DELETE_EVENT_ID, canceledSec),
    );
    expect((await companyRow()).subscription_status).toBe("canceled");
    expect((await numberRow()).status).toBe("suspended");

    const deletesBefore = h.telnyx.callsTo(
      "DELETE",
      /\/v2\/phone_numbers\//,
    ).length;
    const campaignDeletesBefore = h.telnyx.callsTo(
      "DELETE",
      /\/v2\/10dlc\/campaign\//,
    ).length;

    // Wind the clock 31 days past the cancellation and run the §11 grace cron.
    const windForward = new Date(canceledSec * 1000 + 31 * DAY_MS);
    await runGraceJob(getEnv(h.env), windForward);

    // The number is released (row + the Telnyx DELETE), the campaign
    // deactivated (its Telnyx DELETE), and the final email captured.
    expect((await numberRow()).status).toBe("released");
    expect(h.telnyx.callsTo("DELETE", /\/v2\/phone_numbers\//).length).toBe(
      deletesBefore + 1,
    );
    expect(
      h.telnyx.callsTo("DELETE", new RegExp(`/v2/phone_numbers/${TELNYX_PN_ID}$`)),
    ).toHaveLength(1);

    expect((await campaignRow()).deactivated_at).not.toBeNull();
    expect(
      h.telnyx.callsTo("DELETE", /\/v2\/10dlc\/campaign\//).length,
    ).toBe(campaignDeletesBefore + 1);
    expect(
      h.telnyx.callsTo(
        "DELETE",
        new RegExp(`/v2/10dlc/campaign/${CAMPAIGN_TELNYX_ID}$`),
      ),
    ).toHaveLength(1);

    const finalEmail = h.emails.find((e) =>
      e.subject.includes("has been released"),
    );
    expect(finalEmail).toBeTruthy();
  });
});
