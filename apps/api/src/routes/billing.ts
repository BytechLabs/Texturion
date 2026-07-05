import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import {
  hasLiveSubscription,
  PLAN_IDS,
  PLAN_LIMITS,
  planPrices,
  type LocalSubscriptionStatus,
  type PlanId,
} from "../billing/plans";
import {
  owesUsRegistration,
  registrationDraftComplete,
  type RegistrationRow,
} from "../billing/registration-draft";
import { getStripe, type Stripe } from "../billing/stripe";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";

const planBodySchema = z.object({ plan: z.enum(PLAN_IDS) });

interface BillingCompany {
  id: string;
  plan: PlanId | null;
  country: string;
  us_texting_enabled: boolean;
  subscription_status: LocalSubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  registration_fee_paid_at: string | null;
}

async function fetchCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<BillingCompany> {
  const { data, error } = await db
    .from("companies")
    .select(
      "id,plan,country,us_texting_enabled,subscription_status," +
        "stripe_customer_id,stripe_subscription_id,registration_fee_paid_at",
    )
    .eq("id", companyId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  // supabase-js cannot statically type an untyped-database select; the row
  // shape is the selected column list above.
  const row = (data?.[0] ?? null) as unknown as BillingCompany | null;
  if (!row) throw new ApiError("not_found", "Company not found.");
  return row;
}

/**
 * A subscription item is the metered (overage) half iff its price is bound to
 * a Billing Meter; the licensed flat price has no meter (SPEC §9 catalog).
 */
function isMeteredItem(item: Stripe.SubscriptionItem): boolean {
  return Boolean(item.price.recurring?.meter);
}

async function countNonReleasedNumbers(
  db: SupabaseClient,
  companyId: string,
): Promise<number> {
  const { count, error } = await db
    .from("phone_numbers")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .neq("status", "released");
  if (error) throw new Error(`phone_numbers count failed: ${error.message}`);
  return count ?? 0;
}

async function countActiveMembers(
  db: SupabaseClient,
  companyId: string,
): Promise<number> {
  const { count, error } = await db
    .from("company_members")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .is("deactivated_at", null);
  if (error) throw new Error(`company_members count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Billing routes (SPEC §7, §9). Mounted by the integration layer under
 * `/v1/billing`, behind the /v1 middleware chain (JWT + company context).
 * All three routes are owner/admin (SPEC §10 role matrix).
 */
export const billingRoutes = new Hono<AppEnv>();

billingRoutes.use("*", requireRole("admin"));

/**
 * POST /v1/billing/checkout (SPEC §4.1 step 4, §9 checkout composition).
 */
billingRoutes.post("/checkout", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);

  const parsed = planBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      "validation_failed",
      "Body must be { plan: 'starter' | 'pro' }.",
    );
  }
  const { plan } = parsed.data;

  const company = await fetchCompany(db, c.get("companyId"));

  // Gate 1 (409): one subscription per company, ever concurrent.
  if (hasLiveSubscription(company.subscription_status)) {
    return errorResponse(
      c,
      "conflict",
      "This company already has a subscription.",
    );
  }

  // Gate 2 (409): a company that owes US registration may not reach payment
  // without a submittable brand + campaign draft (SPEC §4.1 step 4).
  const owesRegistration = owesUsRegistration(company);
  if (owesRegistration) {
    const { data, error } = await db
      .from("messaging_registrations")
      .select("kind,status,sole_proprietor,data")
      .eq("company_id", company.id);
    if (error) {
      throw new Error(`messaging_registrations lookup failed: ${error.message}`);
    }
    if (!registrationDraftComplete((data ?? []) as RegistrationRow[])) {
      return errorResponse(
        c,
        "conflict",
        "Complete the US texting registration details before checkout.",
      );
    }
  }

  const prices = planPrices(env, plan);
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: prices.licensed, quantity: 1 },
    // Metered price: NO quantity — required for metered items (SPEC §9).
    { price: prices.metered },
  ];
  // One-time $29 US-registration fee: only while the company owes registration
  // AND has never paid the fee — at most once per company, ever (SPEC §2, §9).
  if (owesRegistration && company.registration_fee_paid_at === null) {
    lineItems.push({ price: env.STRIPE_US_FEE_PRICE_ID, quantity: 1 });
  }

  const session = await getStripe(env).checkout.sessions.create({
    mode: "subscription",
    client_reference_id: company.id,
    // Resubscribes reuse the existing Stripe customer so invoices, tax state,
    // and the meter's customer mapping stay on one object.
    ...(company.stripe_customer_id
      ? { customer: company.stripe_customer_id }
      : {}),
    line_items: lineItems,
    automatic_tax: { enabled: true },
    // Land directly on the real post-checkout surfaces (the onboarding step
    // machine routes a just-paid company to setting-up, an unpaid one back to
    // plan). Avoids a /dashboard 307 hop whose extra navigation the offline
    // service worker could mask as "You're offline" on a slow return.
    success_url: `${env.APP_ORIGIN}/onboarding/setting-up?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_ORIGIN}/onboarding/plan?checkout=canceled`,
  });

  if (!session.url) {
    throw new Error(`Stripe checkout session ${session.id} returned no URL.`);
  }
  return c.json({ url: session.url });
});

/**
 * POST /v1/billing/portal — hosted portal session (payment methods, invoices,
 * cancellation only; plan switching happens in-app — SPEC §9).
 */
billingRoutes.post("/portal", async (c) => {
  const env = getEnv(c.env);
  const company = await fetchCompany(getDb(env), c.get("companyId"));

  if (!company.stripe_customer_id) {
    return errorResponse(
      c,
      "conflict",
      "No billing account yet — complete checkout first.",
    );
  }

  const session = await getStripe(env).billingPortal.sessions.create({
    customer: company.stripe_customer_id,
    return_url: `${env.APP_ORIGIN}/settings/billing`,
  });
  return c.json({ url: session.url });
});

/**
 * POST /v1/billing/change-plan (SPEC §9 plan changes):
 * upgrades swap both subscription items to the Pro prices with
 * `proration_behavior='always_invoice'` (immediate); downgrades apply at
 * period end via a subscription schedule and are blocked (409) until extra
 * numbers are released and active members fit the Starter seat limit.
 */
billingRoutes.post("/change-plan", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);

  const parsed = planBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      "validation_failed",
      "Body must be { plan: 'starter' | 'pro' }.",
    );
  }
  const target = parsed.data.plan;

  const company = await fetchCompany(db, c.get("companyId"));
  if (!company.stripe_subscription_id || company.plan === null) {
    return errorResponse(
      c,
      "conflict",
      "No subscription to change — complete checkout first.",
    );
  }
  if (company.plan === target) {
    return errorResponse(c, "conflict", `Already on the ${target} plan.`);
  }

  const stripe = getStripe(env);
  const subscription = await stripe.subscriptions.retrieve(
    company.stripe_subscription_id,
  );
  const licensedItem = subscription.items.data.find(
    (item) => !isMeteredItem(item),
  );
  const meteredItem = subscription.items.data.find(isMeteredItem);
  if (!licensedItem || !meteredItem) {
    throw new Error(
      `Subscription ${subscription.id} does not carry the licensed+metered item pair.`,
    );
  }

  if (target === "pro") {
    // UPGRADE: immediate, prorated onto an invoice issued now (SPEC §9).
    const prices = planPrices(env, "pro");
    await stripe.subscriptions.update(subscription.id, {
      items: [
        { id: licensedItem.id, price: prices.licensed },
        { id: meteredItem.id, price: prices.metered },
      ],
      proration_behavior: "always_invoice",
    });
    // Mirror immediately; the subscription.updated webhook re-mirrors from a
    // re-fetch anyway (SPEC §9 out-of-order guard).
    const { error } = await db
      .from("companies")
      .update({ plan: "pro" })
      .eq("id", company.id);
    if (error) throw new Error(`companies plan update failed: ${error.message}`);
    return c.json({ plan: "pro", effective: "now" });
  }

  // DOWNGRADE: blocked until the tenant fits Starter limits (SPEC §9).
  const numberCount = await countNonReleasedNumbers(db, company.id);
  if (numberCount > PLAN_LIMITS.starter.numbers) {
    return errorResponse(
      c,
      "conflict",
      "Release your extra phone number before downgrading to Starter.",
    );
  }
  const memberCount = await countActiveMembers(db, company.id);
  if (memberCount > PLAN_LIMITS.starter.seats) {
    return errorResponse(
      c,
      "conflict",
      `Starter allows ${PLAN_LIMITS.starter.seats} members — deactivate extra members before downgrading.`,
    );
  }

  // Apply at period end via a subscription schedule (the hosted portal cannot
  // switch plans on multi-item usage-based subscriptions — SPEC §9).
  const scheduleId =
    typeof subscription.schedule === "string"
      ? subscription.schedule
      : subscription.schedule?.id;
  const schedule = scheduleId
    ? await stripe.subscriptionSchedules.retrieve(scheduleId)
    : await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
      });

  const currentPeriodEnd = licensedItem.current_period_end;
  const phaseStart =
    schedule.current_phase?.start_date ?? schedule.phases[0].start_date;
  const starterPrices = planPrices(env, "starter");
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        // Current phase: today's items, unchanged, through the period end.
        items: subscription.items.data.map((item) =>
          isMeteredItem(item)
            ? { price: item.price.id }
            : { price: item.price.id, quantity: item.quantity ?? 1 },
        ),
        start_date: phaseStart,
        end_date: currentPeriodEnd,
      },
      {
        items: [
          { price: starterPrices.licensed, quantity: 1 },
          { price: starterPrices.metered },
        ],
      },
    ],
  });

  return c.json({
    plan: "starter",
    effective: "period_end",
    effective_at: new Date(currentPeriodEnd * 1000).toISOString(),
  });
});
