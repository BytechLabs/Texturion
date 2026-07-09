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
import { enabledModules, isSellableModule } from "../billing/company-modules";
import { idempotencyKey } from "../billing/idempotency";
import {
  MODULE_CATALOG,
  moduleForPrice,
  modulePrice,
  PLAN_MODULES,
} from "../billing/modules";
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
import { handleCheckoutCompleted, isProvisionableCheckout } from "../webhooks/stripe";

const planBodySchema = z.object({
  plan: z.enum(PLAN_IDS),
  // #12 plan builder: opt-in module add-ons selected at checkout.
  modules: z.array(z.enum(PLAN_MODULES)).optional(),
});

const moduleBodySchema = z.object({
  module: z.enum(PLAN_MODULES),
  enabled: z.boolean(),
});

const confirmCheckoutSchema = z.object({
  sessionId: z.string().min(1),
});

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
  // De-dupe the selected modules (order-independent; a repeat is not an error).
  const selectedModules = [...new Set(parsed.data.modules ?? [])];

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

  // #12 plan-builder modules: one flat licensed line item per selected add-on.
  // A module that isn't sellable yet (#41: regions_ca gates nothing until
  // multi-region provisioning ships — selling it charges $5/mo for nothing) or
  // whose Stripe price isn't provisioned in this environment is rejected
  // rather than silently dropped (the customer would be under-charged and
  // think they bought it). Enablement is written on checkout.completed.
  for (const module of selectedModules) {
    const price = modulePrice(env, module);
    if (!isSellableModule(module) || !price) {
      return errorResponse(
        c,
        "validation_failed",
        `The ${MODULE_CATALOG[module].label} add-on isn't available yet.`,
      );
    }
    lineItems.push({ price, quantity: 1 });
  }

  const session = await getStripe(env).checkout.sessions.create(
    {
    mode: "subscription",
    client_reference_id: company.id,
    // Let customers enter a Stripe promo code at checkout (marketing promos and
    // comp accounts). A 100%-off code makes a $0 session that reports
    // payment_status 'no_payment_required'; handleCheckoutCompleted provisions
    // on that too, so a comp'd company still gets its number.
    allow_promotion_codes: true,
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
    },
    // Stable, cart-derived key: two concurrent identical submits collapse to ONE
    // Checkout Session (Stripe replays the first), so a double-click can never
    // start two subscriptions. A genuinely different cart (plan/modules) yields a
    // different key and its own session, as intended. handleCheckoutCompleted's
    // activation claim is the completion-side backstop for the different-cart case.
    {
      idempotencyKey: idempotencyKey(
        company.id,
        "checkout",
        plan,
        selectedModules.slice().sort().join(","),
      ),
    },
  );

  if (!session.url) {
    throw new Error(`Stripe checkout session ${session.id} returned no URL.`);
  }
  return c.json({ url: session.url });
});

/**
 * POST /v1/billing/confirm-checkout — the resilience nudge for the return from
 * hosted Checkout (SPEC §9). The success_url lands the browser on
 * /onboarding/setting-up?session_id=…; the setting-up screen posts that id
 * here. We retrieve the session, verify it belongs to THIS company and is paid,
 * then apply the EXACT same activation as the `checkout.session.completed`
 * webhook (handleCheckoutCompleted) — fully idempotent, so a later webhook /
 * sweeper delivery is a harmless no-op.
 *
 * Why this exists: activation must not hang solely on the async webhook. A
 * delayed, dropped, or (in local dev, without `stripe listen`) never-forwarded
 * webhook otherwise strands a paying customer as `incomplete` — the app then
 * bounces /for-you → /onboarding/plan and the setting-up screen sits forever on
 * "Confirming your payment". This route flips the company active the moment the
 * customer returns from Checkout. Owner/admin only (this group requires admin).
 */
billingRoutes.post("/confirm-checkout", async (c) => {
  const env = getEnv(c.env);
  const parsed = confirmCheckoutSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return errorResponse(c, "validation_failed", "Body must be { sessionId }.");
  }

  const companyId = c.get("companyId");
  const session = await getStripe(env).checkout.sessions.retrieve(
    parsed.data.sessionId,
  );
  // Authz: only act on a session created for THIS company (checkout sets
  // client_reference_id = company id). Never activate off a foreign session.
  if (session.client_reference_id !== companyId) {
    return errorResponse(
      c,
      "forbidden",
      "That checkout session isn't for this company.",
    );
  }
  if (!isProvisionableCheckout(session)) {
    // Still settling on Stripe's side — the setting-up poller retries.
    return c.json({ confirmed: false });
  }

  // Apply activation in the background so a slow Telnyx provisioning call never
  // stalls the response; handleCheckoutCompleted is idempotent with the webhook.
  c.executionCtx.waitUntil(handleCheckoutCompleted(env, session));
  return c.json({ confirmed: true });
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
          // #12: carry the company's purchased add-on modules through the
          // downgrade. Modules are plan-agnostic, so without this Stripe would
          // drop them at period end while company_modules stays enabled —
          // handing the customer the paid capability for $0 (and us the cost).
          ...subscription.items.data
            .filter((item) => moduleForPrice(env, item.price.id) !== null)
            .map((item) => ({ price: item.price.id, quantity: 1 })),
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

/**
 * GET /v1/billing/modules (#12 plan builder) — the module catalog with each
 * one's current enabled state, for the settings plan-builder surface.
 */
billingRoutes.get("/modules", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const enabled = new Set(await enabledModules(db, c.get("companyId")));
  return c.json({
    modules: PLAN_MODULES.map((id) => ({
      id,
      label: MODULE_CATALOG[id].label,
      blurb: MODULE_CATALOG[id].blurb,
      detail: MODULE_CATALOG[id].detail ?? null,
      monthly_cents: MODULE_CATALOG[id].monthlyCents,
      enabled: enabled.has(id),
      // #41: `available` is what we can actually DELIVER and bill — an
      // unsellable module (regions_ca until multi-region ships) reads as
      // coming-soon here and is refused by checkout + the toggle below.
      available: isSellableModule(id) && modulePrice(env, id) !== null,
    })),
  });
});

/**
 * #18: rebuild the remaining phases of a subscription schedule so a module's
 * flat price is present in (or absent from) EVERY phase — the current one
 * (which updates the live subscription, prorated onto an immediate invoice)
 * and the scheduled-downgrade one (so the rollover carries the new module set
 * instead of the stale items pinned at downgrade time). Phase boundaries and
 * the other items' prices/quantities are passed through untouched; completed
 * phases cannot be re-supplied to Stripe and are dropped.
 */
async function applyModuleToSchedulePhases(
  stripe: Stripe,
  scheduleId: string,
  price: string,
  enabled: boolean,
): Promise<void> {
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const phases: Stripe.SubscriptionScheduleUpdateParams.Phase[] =
    schedule.phases
      // Stripe requires the supplied list to start at the CURRENT phase.
      .filter((phase) => phase.end_date > nowSeconds)
      .map((phase) => {
        const items = phase.items
          .map((item) => ({
            price: typeof item.price === "string" ? item.price : item.price.id,
            quantity: item.quantity,
          }))
          .filter((item) => enabled || item.price !== price)
          .map((item) =>
            // Metered items carry no quantity (SPEC §9) — omit, don't null.
            item.quantity == null
              ? { price: item.price }
              : { price: item.price, quantity: item.quantity },
          );
        if (enabled && !items.some((item) => item.price === price)) {
          items.push({ price, quantity: 1 });
        }
        return {
          items,
          start_date: phase.start_date,
          end_date: phase.end_date,
        };
      });
  await stripe.subscriptionSchedules.update(scheduleId, {
    phases,
    proration_behavior: "always_invoice",
  });
}

/**
 * POST /v1/billing/modules (#12 plan builder) — turn a module on/off on an
 * existing subscription. Enabling adds the module's flat line item (prorated
 * now); disabling removes it AND clears any capability it gated (voice →
 * forward + missed-call text) so a switched-off module can never keep costing
 * us. Schedule-aware (#18): with a pending downgrade the change is written
 * into the schedule's phases instead of the raw items. Mirrored to
 * `company_modules`; the subscription webhook re-mirrors too.
 */
billingRoutes.post("/modules", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");

  const parsed = moduleBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(
      c,
      "validation_failed",
      "Body must be { module, enabled }.",
    );
  }
  const { module, enabled } = parsed.data;

  const company = await fetchCompany(db, companyId);
  if (!company.stripe_subscription_id || company.plan === null) {
    return errorResponse(
      c,
      "conflict",
      "No subscription yet — complete checkout first.",
    );
  }
  // #44: a canceled (in-grace) or otherwise dead subscription cannot take
  // item changes — Stripe rejects writes against it, which used to surface as
  // an unhandled 500. Say what to do instead.
  if (!hasLiveSubscription(company.subscription_status)) {
    return errorResponse(
      c,
      "conflict",
      "Your subscription is canceled — resubscribe to change add-ons.",
    );
  }
  const price = modulePrice(env, module);
  // #41: refuse to sell what we can't deliver (regions_ca until multi-region
  // ships), and refuse a module with no provisioned price in this environment.
  if (!isSellableModule(module) || !price) {
    return errorResponse(
      c,
      "validation_failed",
      `The ${MODULE_CATALOG[module].label} add-on isn't available yet.`,
    );
  }

  const stripe = getStripe(env);
  const subscription = await stripe.subscriptions.retrieve(
    company.stripe_subscription_id,
  );
  const existingItem = subscription.items.data.find(
    (item) => item.price?.id === price,
  );
  // #18 OWNER DECISION: a pending-downgrade subscription schedule OWNS the
  // subscription's items. Mutating items directly on a schedule-managed
  // subscription is rejected by Stripe (500 to the customer), and even if it
  // landed, the schedule's pinned phase-2 item list would re-apply the OLD
  // module set at period end — re-billing a disabled module or dropping a
  // paid one while company_modules keeps it enabled. So when a schedule is
  // attached we rebuild every remaining phase's item list with the module
  // added/removed (same prices, same phase boundaries) and let Stripe prorate
  // the current-phase change onto an immediate invoice: the toggle takes
  // effect NOW and survives the plan change, instead of locking the customer
  // out of add-on management until period end.
  const scheduleId =
    typeof subscription.schedule === "string"
      ? subscription.schedule
      : subscription.schedule?.id;

  if (enabled) {
    if (scheduleId) {
      await applyModuleToSchedulePhases(stripe, scheduleId, price, true);
    } else if (!existingItem) {
      await stripe.subscriptionItems.create({
        subscription: subscription.id,
        price,
        proration_behavior: "always_invoice",
      });
    }
    const { error } = await db.from("company_modules").upsert(
      {
        company_id: companyId,
        module,
        enabled_at: new Date().toISOString(),
        disabled_at: null,
        // An explicit purchase — from here on the subscription is the truth
        // for this module (#17 reconcile may disable it when unpaid).
        grandfathered: false,
      },
      { onConflict: "company_id,module" },
    );
    if (error) throw new Error(`module enable failed: ${error.message}`);
    return c.json({ module, enabled: true });
  }

  // Disable: drop the line item, mark disabled, and clear the gated capability.
  if (scheduleId) {
    await applyModuleToSchedulePhases(stripe, scheduleId, price, false);
  } else if (existingItem) {
    await stripe.subscriptionItems.del(existingItem.id, {
      proration_behavior: "always_invoice",
    });
  }
  const { error } = await db
    .from("company_modules")
    .update({ disabled_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("module", module)
    .is("disabled_at", null);
  if (error) throw new Error(`module disable failed: ${error.message}`);
  if (module === "voice") {
    // A switched-off voice module must stop forwarding calls — clear the
    // settings the webhook reads so no further call is ever forwarded.
    const { error: voiceError } = await db
      .from("companies")
      .update({ forward_to_cell: null, mctb_enabled: false })
      .eq("id", companyId);
    if (voiceError) {
      throw new Error(`voice settings clear failed: ${voiceError.message}`);
    }
  }
  return c.json({ module, enabled: false });
});
