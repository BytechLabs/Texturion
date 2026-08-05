import { checkoutCurrency } from "../billing/checkout-currency";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import {
  hasLiveSubscription,
  PLAN_IDS,
  PLAN_LIMITS,
  planForLicensedPrice,
  planPrices,
  PREPAY_MONTHS,
  prepayYearPrice,
  type LocalSubscriptionStatus,
  type PlanId,
} from "../billing/plans";
import {
  PAUSE_PRORATION,
  pauseEligibility,
  pausePriceSnapshot,
  pausedLicensedItem,
  planLicensedItem,
  type PauseEligibility,
} from "../billing/pause";
import { enabledModules, isSellableModule } from "../billing/company-modules";
import {
  allExtraNumberPrices,
  extraNumberPrice,
  findExtraNumberItem,
} from "../billing/extra-numbers";
import { cartSignature, idempotencyKey } from "../billing/idempotency";
import {
  PREPAY_METADATA_FIELD,
  PREPAY_METADATA_KIND,
  PREPAY_PLAN_FIELD,
  prepayEligibility,
} from "../billing/prepay";
import {
  allVoiceOveragePrices,
  MODULE_CATALOG,
  moduleForPrice,
  modulePrice,
  PLAN_MODULES,
  voiceOveragePrice,
  isPlanModule,
} from "../billing/modules";
import {
  owesUsRegistration,
  registrationDraftComplete,
  type RegistrationRow,
} from "../billing/registration-draft";
import {
  applyPriceToSchedulePhases,
} from "../billing/schedule-phases";
import { payPendingReferralRewards } from "../referrals/referrals";
import { getStripe, type Stripe } from "../billing/stripe";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { expectOk, parseJsonBody } from "./core/http";
import {
  handleCheckoutCompleted,
  isProvisionableCheckout,
  syncSubscription,
} from "../webhooks/stripe";

const planBodySchema = z.object({
  plan: z.enum(PLAN_IDS),
  // #12 plan builder: opt-in module add-ons selected at checkout.
  // #134 review (deploy skew): accept ANY string ids and silently DROP
  // retired ones below — a pre-D42 bundle still selling the $8 Calling
  // add-on must not dead-end at the pay button with a 422. Unknown ids that
  // were never modules still 422 (typo protection).
  // Bounded: there are only a handful of real module ids, so a 20-item array of
  // ≤64-char strings is generous and rejects an abusive payload with a clean 422
  // (the handler materializes this into a Set + two filter passes).
  modules: z.array(z.string().max(64)).max(20).optional(),
});

const moduleBodySchema = z.object({
  // #134 deploy skew: 'voice' is accepted at the SCHEMA so a stale pre-D42
  // settings bundle toggling the retired Calling add-on gets an HONEST 409
  // ("calling is included now") from the handler instead of a generic 422.
  module: z.enum([...PLAN_MODULES, "voice"] as const),
  enabled: z.boolean(),
});

/**
 * #277. Both fields optional: a reason that cannot be skipped is a reason that
 * cannot be trusted, and this must never add a step to cancelling. The reason
 * is a short code the client picked from its list; `detail` is what they wrote.
 */
const cancellationReasonSchema = z.object({
  reason: z.string().trim().max(40).nullable().optional(),
  detail: z.string().trim().max(2000).nullable().optional(),
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
  /** #328: what this workspace is charged in. */
  billing_currency: string | null;
  /** #277: when this workspace's plan was paused, or null. */
  paused_at: string | null;
  /** #277: what the pause bills per month, USD cents, mirrored from Stripe. */
  paused_price_cents: number | null;
}

async function fetchCompany(
  db: SupabaseClient,
  companyId: string,
): Promise<BillingCompany> {
  const { data, error } = await db
    .from("companies")
    .select(
      "id,plan,country,us_texting_enabled,subscription_status," +
        "stripe_customer_id,stripe_subscription_id,registration_fee_paid_at," +
        // #328: the currency every line item on this session is charged in.
        "billing_currency," +
        // #277: the pause. Read on EVERY billing path rather than only the
        // pause routes — change-plan, prepay and checkout each break in their
        // own way against a subscription whose licensed line is the pause price.
        "paused_at,paused_price_cents",
    )
    .eq("id", companyId)
    // A soft-deleted company is not billable — match usage.ts + the billing
    // background jobs, which all filter deleted_at (it's never hard-deleted).
    .is("deleted_at", null)
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

// #315: billing is its own axis, not a rung on a ladder. The bookkeeper or
// spouse doing the books needs THIS and not every customer conversation, and
// the only way to give it to them today is to make them an admin — which hands
// over the whole inbox, and in practice means the owner shares their login.
// Asking for the capability is the same answer for owner and admin as the rank
// was; it is what lets a preset carry billing alone.
billingRoutes.use("*", requireCapability("billing.manage"));

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
  // De-dupe the selected modules (order-independent; a repeat is not an
  // error). #134 deploy skew: RETIRED ids (voice, mms, extra_storage) are
  // silently dropped — the capability is included/free now, so honoring the
  // stale bundle's intent means "check out without it". Ids that were NEVER
  // modules are a 422 (typo/abuse protection).
  const RETIRED_MODULE_IDS = new Set(["voice", "mms", "extra_storage"]);
  const requestedModules = [...new Set(parsed.data.modules ?? [])];
  const unknownModules = requestedModules.filter(
    (id) => !isPlanModule(id) && !RETIRED_MODULE_IDS.has(id),
  );
  if (unknownModules.length > 0) {
    return errorResponse(
      c,
      "validation_failed",
      `Unknown module: ${unknownModules[0]}.`,
    );
  }
  const selectedModules = requestedModules.filter(isPlanModule);

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
    // #381/#458: an EMPTY registration is now the normal pre-checkout state —
    // `business` moved behind the paywall, so the identity details do not
    // exist yet and refusing checkout for their absence would 409 every new
    // US signup. A PARTIAL one still blocks: that is the resubmit path, where
    // a half-filled draft reaching checkout would submit garbage to the
    // carrier. Submission itself is safe either way — `submitRegistration`
    // no-ops on an incomplete draft, and the second trigger in
    // routes/registration.ts fires when the details finally land.
    const rows = (data ?? []) as RegistrationRow[];
    const started = rows.some((row) => Object.keys(row.data ?? {}).length > 0);
    if (started && !registrationDraftComplete(rows)) {
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
  // D36/#134: calling is INCLUDED on every plan, so EVERY checkout carries
  // the per-plan voice metered overage price (tier 1 at $0 up to the
  // fair-use allowance, then 1¢/min). NO quantity — metered. Unprovisioned →
  // minutes go unbilled, never over-billed.
  {
    const voiceMetered = voiceOveragePrice(env, plan);
    if (voiceMetered) lineItems.push({ price: voiceMetered });
  }

  // #328: what the workspace should be charged in, reconciled against what the
  // catalog can presently honour. Read once, before the session, because a
  // currency the price does not carry gets the whole session refused.
  const sessionCurrency = await checkoutCurrency(getStripe(env), {
    wanted: company.billing_currency,
    licensedPriceId: planPrices(env, plan).licensed,
  });

  const session = await getStripe(env).checkout.sessions.create(
    {
    mode: "subscription",
    // #328: the currency this session charges in — see checkout-currency.ts.
    //
    // Stripe pins the currency on the SUBSCRIPTION, which is why the company
    // row is the source rather than a request field: a session must never
    // charge in a currency the workspace did not choose.
    //
    // Resolved against the CATALOG rather than taken on trust, because a
    // session asking for a currency the price does not carry is refused
    // outright — and the CAD price book shipped before the Stripe catalog
    // could be updated.
    currency: sessionCurrency,
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
    // start two subscriptions. A genuinely different cart yields a different key
    // and its own session, as intended. handleCheckoutCompleted's activation
    // claim is the completion-side backstop for the different-cart case.
    //
    // #260: the key is derived from the LINE ITEMS, not from a hand-listed set
    // of inputs. It used to be plan + modules, and the $29 US-registration line
    // depends on neither — it depends on country, us_texting_enabled and
    // registration_fee_paid_at. Both of the first two are editable on the plan
    // step between two attempts BY DESIGN, so a customer who changed their US
    // answer produced the same key with different parameters, Stripe returned
    // idempotency_error, and checkout was hard-blocked for ~24 hours with no
    // way out. Deriving the key from the cart it describes means any future
    // line-item input is covered by construction rather than by remembering to
    // add it here.
    {
      idempotencyKey: idempotencyKey(
        company.id,
        "checkout",
        cartSignature(lineItems),
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
 *
 * #421 — THE BUNDLE IS SPLIT BY ROLE.
 *
 * Closing the workspace is owner-only. Cancelling the subscription ends in the
 * same place — `grace.ts` releases the number 30 days later, and a released
 * number goes back to carrier inventory and is reassigned to another business
 * (#413) — but it happened on Stripe's domain and so was never gated. An admin
 * could start an irreversible clock ending with the company's phone number
 * belonging to somebody else.
 *
 * Admin-level billing is still right for the ordinary case: a bookkeeper
 * updating an expiring card should not have to be the owner, and forcing that
 * through the single untransferable owner role (#332) would be worse. The
 * problem was only that Stripe's portal bundles "update the card" with "cancel
 * the subscription" behind one link.
 *
 * It turns out we CAN split it. `flow_data.type = "payment_method_update"`
 * lands the caller directly on the card screen with no route to cancellation,
 * and it needs no account-level portal configuration. So:
 *
 *   owner  → the full portal, cancellation included
 *   admin  → the card-update flow, and nothing else
 *
 * The route stays admin-reachable, which keeps the routine case working; what
 * changes is what an admin can reach once inside.
 */
/**
 * POST /v1/billing/cancellation-reason — #277. Why this workspace is leaving,
 * asked before the handoff to Stripe.
 *
 * ASKED BEFORE, because afterwards they are gone and nobody answers a survey
 * about a product they have just left. But saying why is not leaving: some
 * people read the screen, see what else is on offer, and stay. So this records
 * a STATEMENT, and the `customer.subscription.deleted` webhook stamps
 * `confirmed_at` if the subscription really ends. Two numbers instead of one,
 * and the second - who said why and then stayed - is what any retention offer
 * has to be measured against.
 *
 * NOTHING IS REQUIRED. #277's own devil's advocate is binding: "a reason we
 * cannot skip is a reason we cannot trust", and cancelling must never take more
 * steps than subscribing did. Both fields are optional, and a call with neither
 * is a valid record that somebody skipped the question. The route deliberately
 * does not gate the portal on having been called.
 *
 * UPSERT ON THE OPEN ROW. Opening the cancel screen three times is one person
 * giving one reason, not three, and three rows would triple-count them in every
 * report. The partial unique index on `(company_id) where confirmed_at is null`
 * is what makes that true in the database rather than in this handler.
 *
 * THROUGH AN RPC, because that index cannot be named over PostgREST. A
 * `.upsert(..., { onConflict: "company_id" })` sends a bare `ON CONFLICT
 * (company_id)`, Postgres will not match a bare column list to a PARTIAL index,
 * and every call raised 42P10 and 500ed. `api_record_cancellation_reason`
 * repeats the predicate, which is the one spelling Postgres accepts.
 */
billingRoutes.post("/cancellation-reason", async (c) => {
  const body = await parseJsonBody(c, cancellationReasonSchema);
  const env = getEnv(c.env);
  const db = getDb(env);

  expectOk(
    await db.rpc("api_record_cancellation_reason", {
      p_company_id: c.get("companyId"),
      p_user_id: c.get("userId"),
      p_reason: body.reason ?? null,
      p_detail: body.detail ?? null,
    }),
    "cancellation reason",
  );
  return c.body(null, 204);
});

/**
 * GET /v1/billing/cancellation-reason — #277 follow-up. What they told us, read
 * back, so the canceled-state card can answer during the grace window what the
 * cancel card answered on the way out.
 *
 * A DEDICATED ROUTE RATHER THAN A FIELD ON company_view, and the reasoning is
 * the same one `missed-while-off` beside it already uses. `loadCompanyView` is
 * the hottest path in the product — every GET /v1/company and every GET /v1/me,
 * for every role, on every app boot — and this answer can only ever be non-null
 * for a workspace that has already cancelled. Putting it there would have every
 * paying workspace run a query for a feature it can never see, forever, and the
 * card that needs it renders on exactly one screen in exactly one state.
 *
 * THE OPEN ROW ONLY. `confirmed_at is null` is what the partial unique index
 * makes at-most-one of; a confirmed row belongs to a cancellation that has
 * already run its course, and answering a year-old reason on a new one would be
 * answering a question nobody just asked.
 *
 * NEVER THE FREE TEXT. `detail` is what somebody wrote about us, in their own
 * words, and reading it back to them on a win-back card would be quoting them at
 * themselves. The reason CODE is all the card needs to pick an answer.
 *
 * `billing.manage` like every route in this file: a stated reason for leaving is
 * not something a tech should be able to read off their own workspace.
 */
billingRoutes.get("/cancellation-reason", async (c) => {
  const db = getDb(getEnv(c.env));
  const { data, error } = await db
    .from("cancellation_reasons")
    .select("reason,created_at")
    .eq("company_id", c.get("companyId"))
    .is("confirmed_at", null)
    .limit(1);
  if (error) throw new Error(`cancellation reason lookup failed: ${error.message}`);
  const row = (data ?? [])[0] as
    | { reason: string | null; created_at: string }
    | undefined;
  // `reason: null` is a real answer and NOT the same as no row: it means
  // somebody opened the cancel screen and skipped the question, which is
  // allowed on purpose. Both render nothing, but only one of them is a person
  // declining to say, and the report the whole feature feeds counts them apart.
  return c.json({
    reason: row?.reason ?? null,
    stated_at: row?.created_at ?? null,
  });
});

/**
 * POST /v1/billing/dismiss-winback — #277 follow-up. "Stop showing me this."
 *
 * The grace emails on day 1, 15 and 27 all link to /settings/billing, so the
 * canceled-state card is seen on a cadence rather than once. Anything shown
 * three times needs a way to be shown zero times, and until now there was no
 * dismissal state anywhere in the schema.
 *
 * A TIMESTAMP, COMPARED AGAINST `canceled_at`, not a boolean — the reasoning is
 * in the migration and the property is that a dismissal belongs to ONE
 * cancellation. Somebody who dismisses this, resubscribes, and cancels again a
 * year later gets the offer back, because that second cancellation stamps a
 * newer `canceled_at` than the dismissal. Nothing has to clear it.
 *
 * DELIBERATELY UNCONDITIONAL. It does not check that the workspace is cancelled
 * first: a stamp written while nothing is cancelled suppresses nothing (the next
 * `canceled_at` is later than it), so the guard would only add a way for a
 * legitimate press to fail. 204 for the same reason a dismissal is not worth a
 * body — there is nothing the client needs back that it did not already know.
 */
billingRoutes.post("/dismiss-winback", async (c) => {
  const db = getDb(getEnv(c.env));
  expectOk(
    await db
      .from("companies")
      .update({ winback_dismissed_at: new Date().toISOString() })
      .eq("id", c.get("companyId"))
      // A soft-deleted company is not billable — matches fetchCompany above.
      .is("deleted_at", null),
    "dismiss winback",
  );
  return c.body(null, 204);
});

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

  const isOwner = c.get("role") === "owner";
  const returnUrl = `${env.APP_ORIGIN}/settings/billing`;
  const session = await getStripe(env).billingPortal.sessions.create(
    isOwner
      ? { customer: company.stripe_customer_id, return_url: returnUrl }
      : {
          customer: company.stripe_customer_id,
          return_url: returnUrl,
          // Not a lesser portal — a DIFFERENT one. The card-update flow has no
          // cancellation surface at all, so this is a structural limit rather
          // than a hidden button.
          flow_data: { type: "payment_method_update" },
        },
  );
  return c.json({ url: session.url, scope: isOwner ? "full" : "payment_method" });
});

/**
 * POST /v1/billing/change-plan (SPEC §9 plan changes):
 * upgrades swap both subscription items to the Pro prices with
 * `proration_behavior='always_invoice'` (immediate); downgrades apply at
 * period end via a subscription schedule and are blocked (409) until extra
 * numbers are released and active members fit the Starter seat limit.
 */
/**
 * The item-level discounts on a subscription item, in the shape a SCHEDULE
 * PHASE takes — or nothing when there are none.
 *
 * #400/D107. Rebuilding a phase from a bare price id silently drops every
 * discount on that line, and the discount on the licensed line is a prepaid
 * year somebody paid for. Spread rather than always-set so a subscription with
 * no discounts produces exactly the payload it produced before.
 */
function phaseDiscounts(
  item: Stripe.SubscriptionItem,
): { discounts?: { coupon: string }[] } {
  const raw = (item as unknown as { discounts?: unknown[] }).discounts ?? [];
  const coupons = raw
    .map((d) =>
      typeof d === "string"
        ? d
        : ((d as { coupon?: string | { id?: string } })?.coupon as string | undefined) ??
          ((d as { coupon?: { id?: string } })?.coupon?.id ?? undefined),
    )
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return coupons.length > 0
    ? { discounts: coupons.map((coupon) => ({ coupon })) }
    : {};
}

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
  // A canceled subscription keeps `plan` + `stripe_subscription_id` populated
  // (handleSubscriptionDeleted only flips subscription_status), so without this
  // guard change-plan would call Stripe against a dead subscription and 500 —
  // the same guard its /modules sibling already has.
  if (!hasLiveSubscription(company.subscription_status)) {
    return errorResponse(
      c,
      "conflict",
      "Your subscription is canceled — resubscribe to change plans.",
    );
  }
  /**
   * #277 — a paused workspace changing plans gets a sentence, not a 500.
   *
   * Below, the licensed+metered pair is located by price and a miss THROWS,
   * which becomes an `internal_error` and a Sentry alert. That throw is right
   * for what it was written for — a subscription missing its own plan prices is
   * a genuine invariant violation — but a paused subscription carries the pause
   * price instead of a plan price, so it hits that throw by design. The
   * customer sees "Something went wrong" for a perfectly ordinary thing to try,
   * and the founder gets paged for it.
   *
   * Refused rather than performed, and not because performing it is hard: a
   * plan change during a pause is ambiguous in a way only the customer can
   * settle. Do they want to resume now on the new plan, or to keep paying the
   * holding fee and land on the new plan in spring? Guessing the first bills
   * them today for a plan they may not want yet; guessing the second stores an
   * intention with no visible place to see or cancel it. So: resume, then
   * change, in that order — two clear steps instead of one silent assumption.
   */
  if (company.paused_at) {
    return errorResponse(
      c,
      "conflict",
      "Your plan is paused. Resume it first, then switch plans — that way you " +
        "choose when the new plan starts billing.",
    );
  }

  const stripe = getStripe(env);
  const subscription = await stripe.subscriptions.retrieve(
    company.stripe_subscription_id,
  );
  // D36: a voice-module subscription carries TWO metered items (SMS + voice),
  // so "the metered item" must be identified by price, not by find-first.
  const licensedItem = subscription.items.data.find(
    (item) => planForLicensedPrice(env, item.price.id) !== null,
  );
  const smsOveragePrices = new Set([
    env.STRIPE_STARTER_OVERAGE_PRICE_ID,
    env.STRIPE_PRO_OVERAGE_PRICE_ID,
  ]);
  const meteredItem = subscription.items.data.find((item) =>
    smsOveragePrices.has(item.price.id),
  );
  if (!licensedItem || !meteredItem) {
    throw new Error(
      `Subscription ${subscription.id} does not carry the licensed+metered item pair.`,
    );
  }
  const voiceOveragePriceSet = new Set(allVoiceOveragePrices(env));
  const voiceMeteredItem = subscription.items.data.find((item) =>
    voiceOveragePriceSet.has(item.price.id),
  );

  if (target === "pro") {
    // UPGRADE: immediate, prorated onto an invoice issued now (SPEC §9).
    const prices = planPrices(env, "pro");
    // #105: a paid Starter extra-number item must move to the Pro price ($4)
    // WITH the upgrade — left behind it would bill the Starter price forever,
    // invisible to the (per-plan-price) convergence formula.
    const starterExtraPrice = extraNumberPrice(env, "starter");
    const proExtraPrice = extraNumberPrice(env, "pro");
    const extraItem = starterExtraPrice
      ? findExtraNumberItem(subscription, starterExtraPrice)
      : undefined;
    // D36: the voice metered item must move to the Pro tiering (allowance
    // 6,000, not 2,500) WITH the upgrade — left on the Starter price it would
    // over-bill minutes 2,500–6,000 that the Pro allowance includes. If the
    // Pro voice price isn't provisioned, DROP the item (unbilled beats
    // over-billed; the toggle re-attaches once provisioned).
    const proVoicePrice = voiceOveragePrice(env, "pro");
    await stripe.subscriptions.update(subscription.id, {
      items: [
        { id: licensedItem.id, price: prices.licensed },
        { id: meteredItem.id, price: prices.metered },
        ...(extraItem && proExtraPrice
          ? [
              {
                id: extraItem.id,
                price: proExtraPrice,
                quantity: extraItem.quantity ?? 1,
              },
            ]
          : []),
        ...(voiceMeteredItem
          ? [
              proVoicePrice
                ? { id: voiceMeteredItem.id, price: proVoicePrice }
                : { id: voiceMeteredItem.id, deleted: true as const },
            ]
          : []),
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
    // #345: the plan is what the workspace is billed and limited by, so "who
    // moved us to Pro, and when" is a question with a real answer attached to
    // it. Recorded after the mirror, so the row only exists for a change that
    // actually took.
    await recordAuditFromRequest(db, c, {
      companyId: company.id,
      action: "billing.plan_changed",
      targetType: "company",
      targetId: company.id,
      before: { plan: "starter" },
      after: { plan: "pro", effective: "now" },
    });
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
  const starterSeats = PLAN_LIMITS.starter.seats;
  if (memberCount > starterSeats) {
    return errorResponse(
      c,
      "conflict",
      `Starter allows ${starterSeats} members — deactivate extra members before downgrading.`,
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
  // #105: the downgrade requires count ≤ 1, so ANY surviving extra-number item
  // is stale (a crashed release-convergence). Pin it into NEITHER phase — the
  // current-phase drop credits it now instead of freezing the charge into the
  // schedule for up to a month.
  const staleExtraPrices = new Set(allExtraNumberPrices(env));
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        // Current phase: today's items, unchanged, through the period end.
        //
        // #400/D107: `discounts` is carried through explicitly. A phase is
        // rebuilt from a bare item LIST, so anything not re-emitted here is
        // dropped — and the thing that would be dropped is the 100%-off coupon
        // that IS somebody's prepaid year. Up to $711 of paid Pro service would
        // evaporate the instant they asked for a smaller plan, and nothing
        // would notice, because the only record was the object being replaced.
        items: subscription.items.data
          .filter((item) => !staleExtraPrices.has(item.price.id))
          .map((item) =>
            isMeteredItem(item)
              ? { price: item.price.id }
              : {
                  price: item.price.id,
                  quantity: item.quantity ?? 1,
                  ...phaseDiscounts(item),
                },
          ),
        start_date: phaseStart,
        end_date: currentPeriodEnd,
      },
      {
        items: [
          // #400/D107: the prepaid discount rides the licensed line into the
          // NEW phase too. Without this the coupon simply stops at rollover and
          // the customer starts paying again for months they already bought.
          {
            price: starterPrices.licensed,
            quantity: 1,
            ...phaseDiscounts(licensedItem),
          },
          { price: starterPrices.metered },
          // #12: carry the company's purchased add-on modules through the
          // downgrade. Modules are plan-agnostic, so without this Stripe would
          // drop them at period end while company_modules stays enabled —
          // handing the customer the paid capability for $0 (and us the cost).
          ...subscription.items.data
            .filter((item) => moduleForPrice(env, item.price.id) !== null)
            .map((item) => ({ price: item.price.id, quantity: 1 })),
          // D36: the voice metered item rolls over on the STARTER tiering
          // (allowance 2,500) — the Pro price left in place would under-bill
          // by treating minutes up to 6,000 as included. Unprovisioned →
          // dropped at rollover (unbilled, never mis-billed).
          ...(voiceMeteredItem && voiceOveragePrice(env, "starter")
            ? [{ price: voiceOveragePrice(env, "starter") as string }]
            : []),
        ],
      },
    ],
  });

  // #345: a downgrade is the half worth having most. It takes effect at the
  // period end, so the person who notices the smaller allowance is rarely the
  // person who chose it, and often weeks later.
  await recordAuditFromRequest(db, c, {
    companyId: company.id,
    action: "billing.plan_changed",
    targetType: "company",
    targetId: company.id,
    before: { plan: "pro" },
    after: {
      plan: "starter",
      effective: "period_end",
      effective_at: new Date(currentPeriodEnd * 1000).toISOString(),
    },
  });
  return c.json({
    plan: "starter",
    effective: "period_end",
    effective_at: new Date(currentPeriodEnd * 1000).toISOString(),
  });
});

/**
 * GET /v1/billing/prepay (#400/D107) — may this workspace buy a year, and is
 * one already running?
 *
 * One request answers both, because the surface needs both: the offer renders
 * only when eligible, and a workspace already inside a window should see when
 * it ends rather than the offer again.
 */
billingRoutes.get("/prepay", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const company = await fetchCompany(db, c.get("companyId"));

  // The schedule gate needs the live subscription. Skipped entirely for a
  // company that has none — that is the no_subscription answer anyway, and it
  // saves a Stripe round trip on the surface that polls this.
  let subscription: Stripe.Subscription | null = null;
  if (company.stripe_subscription_id) {
    subscription = await getStripe(env).subscriptions.retrieve(
      company.stripe_subscription_id,
    );
  }
  const eligibility = await prepayEligibility(env, db, company, subscription);

  return c.json({
    eligible: eligibility.eligible,
    reason: eligibility.reason ?? null,
    price_cents: eligibility.priceCents ?? null,
    months: PREPAY_MONTHS,
    open: eligibility.open
      ? {
          plan: eligibility.open.plan,
          amount_cents: eligibility.open.amount_cents,
          granted_through: eligibility.open.granted_through,
        }
      : null,
  });
});

/**
 * POST /v1/billing/prepay (#400/D107) — buy a year up front.
 *
 * A ONE-TIME Checkout Session. The money buys a 100%-off coupon on the licensed
 * subscription item for twelve months (see billing/prepay.ts); the subscription
 * itself is never touched here, which is the whole point of D107.
 *
 * `automatic_tax` is on because Stripe Tax is live with a Canadian registration,
 * so GST/HST is charged at collection — the monthly licensed line is then $0 and
 * carries no tax, and no supply is taxed twice.
 */
billingRoutes.post("/prepay", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const company = await fetchCompany(db, c.get("companyId"));

  let subscription: Stripe.Subscription | null = null;
  if (company.stripe_subscription_id) {
    subscription = await getStripe(env).subscriptions.retrieve(
      company.stripe_subscription_id,
    );
  }
  const eligibility = await prepayEligibility(env, db, company, subscription);
  if (!eligibility.eligible) {
    // Each refusal says the thing the customer can act on, and no more. An
    // unprovisioned catalog is our problem, not theirs.
    const message =
      eligibility.reason === "not_activated"
        ? "Send your first message first, then you can pay for a year up front."
        : eligibility.reason === "subscription_unhealthy"
          ? "Sort out your payment method before paying for a year up front."
          : eligibility.reason === "no_subscription"
            ? "Subscribe first — a year up front pays for a plan you already have."
            : eligibility.reason === "already_prepaid"
              ? "You have already paid for a year. It runs until " +
                new Date(eligibility.open?.granted_through ?? "").toISOString().slice(0, 10) +
                "."
              : eligibility.reason === "plan_change_pending"
                ? "You have a plan change waiting to take effect. Once it lands you can pay for a year."
                : "Paying for a year up front isn't available right now.";
    return errorResponse(c, "conflict", message);
  }

  const plan = company.plan as PlanId;
  const price = prepayYearPrice(env, plan);
  if (!price || !company.stripe_customer_id) {
    return errorResponse(
      c,
      "conflict",
      "Paying for a year up front isn't available right now.",
    );
  }

  const session = await getStripe(env).checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: company.id,
      // The SAME customer as the subscription, always: the discount lands on
      // that customer's subscription, so a payment on a second customer object
      // would buy nothing.
      customer: company.stripe_customer_id,
      line_items: [{ price, quantity: 1 }],
      automatic_tax: { enabled: true },
      // How the webhook tells this from a subscription checkout. Checked rather
      // than inferred from `mode`, because guessing wrong moves money silently.
      metadata: {
        [PREPAY_METADATA_FIELD]: PREPAY_METADATA_KIND,
        [PREPAY_PLAN_FIELD]: plan,
      },
      success_url: `${env.APP_ORIGIN}/settings/billing?prepay=success`,
      cancel_url: `${env.APP_ORIGIN}/settings/billing?prepay=canceled`,
    },
    {
      // Keyed on the plan too: a workspace that upgrades between two attempts is
      // buying a different thing at a different price, and reusing the key would
      // replay the cheaper session.
      idempotencyKey: idempotencyKey(company.id, "prepaid_year", plan),
    },
  );

  if (!session.url) {
    throw new Error(`Stripe prepay session ${session.id} returned no URL.`);
  }
  return c.json({ url: session.url });
});

/**
 * The sentence a refused pause or resume says, per reason.
 *
 * Each names the thing the customer can act on and nothing else — an
 * unprovisioned catalog is our problem, not theirs, which is why
 * `not_provisioned` says the offer is unavailable rather than explaining our
 * configuration. Same shape and same rule as the prepay refusals above.
 */
function pauseRefusal(eligibility: PauseEligibility): string {
  switch (eligibility.reason) {
    case "no_subscription":
      return "Subscribe first — pausing holds a plan you already have.";
    case "already_paused":
      return "Your plan is already paused.";
    case "subscription_unhealthy":
      return "Sort out your payment method first, then you can pause.";
    case "plan_change_pending":
      return "You have a plan change waiting to take effect. Once it lands you can pause.";
    case "already_prepaid":
      return (
        "You have already paid for a year, and it runs until " +
        new Date(eligibility.open?.granted_through ?? "").toISOString().slice(0, 10) +
        ". Pausing would spend those months on a hold instead of on the plan you bought."
      );
    case "prepaid_coupon_orphaned":
      // The `prepayments` row is missing but the year is plainly running, so we
      // cannot name a date the way `already_prepaid` does. Say the true thing:
      // a pause would spend the year on a hold, and support can see the coupon.
      return (
        "Your prepaid year is still running on this plan, so pausing would " +
        "spend those months on a hold instead. Get in touch and we'll sort it out."
      );
    case "referral_month_pending":
      // Same harm as `already_prepaid`, said the same way: the free month rides
      // the line a pause would swap, so pausing spends a $29/$79 credit on a
      // holding fee. Naming the bill it lands on is what makes waiting obvious.
      return (
        "You have a free month from a referral waiting on your next bill. " +
        "Pausing would spend it on the hold instead of on your plan — let it " +
        "land first, then pause."
      );
    default:
      return "Pausing isn't available right now.";
  }
}

/**
 * Mirror the pause fact after a swap that has already landed at Stripe.
 *
 * #277. Both pause routes have the same shape and the same hazard: the Stripe
 * write moves money, and the mirror that follows it can throw. `syncSubscription`
 * raises on any PostgREST error, so a transient database failure used to leave
 * the customer charged for a state our database refuses to grant them — billed
 * for a plan they cannot send on, or texting at full quota on a holding fee.
 *
 * The fallback is NOT a second opinion about what "paused" means. It re-states
 * the conclusion of the swap we just made — that swap either put the pause price
 * on the licensed item or took it off, and Stripe accepted it — and it runs only
 * when the one place that decides could not be reached. When it lands, the
 * canonical writer runs anyway moments later on the `customer.subscription.updated`
 * event our own write produced, and agrees.
 *
 * A failure of BOTH is allowed to throw, and the throw is honest: the database
 * is unreachable, nothing we say about the account would be true, and the retry
 * is the customer pressing the button again — which replays the same Stripe
 * idempotency key rather than charging twice.
 */
async function mirrorAfterSwap(
  env: Env,
  db: SupabaseClient,
  subscriptionId: string,
  fallback: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  try {
    await syncSubscription(env, subscriptionId, db);
  } catch (cause) {
    console.error(
      `pause mirror via syncSubscription failed for ${subscriptionId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
    const { error } = await fallback();
    if (error) throw cause;
  }
}

/**
 * GET /v1/billing/pause (#277) — may this workspace pause, what would it cost,
 * and is it paused already?
 *
 * One request answers all three, because the billing screen needs all three:
 * the offer renders only when eligible, a workspace already paused should see
 * since when rather than the offer again, and the price has to be shown before
 * anybody presses anything.
 *
 * NO PRICE ID CROSSES THIS BOUNDARY. Clients get cents. A price id in a client
 * bundle is a value somebody can put in a checkout call, and mirrors the shape
 * GET /v1/billing/prepay already established.
 *
 * `monthly_cents` COMES FROM TWO PLACES, on purpose:
 *
 *   * PAUSED — the mirror on the company row, written from the subscription
 *     item at pause time. That is genuinely what THIS workspace is being
 *     charged, which the catalog price is not once the founder reprices a pause
 *     somebody is already living on.
 *   * NOT PAUSED AND ELIGIBLE — the live catalog price, read through the same
 *     {@link pausePriceSnapshot} the pause itself is gated on. The mirror is
 *     null until a first pause has happened, so quoting it would price every
 *     FIRST pause blind — asking somebody to agree to a recurring charge whose
 *     amount we refuse to name. And where it is NOT null it is last winter's
 *     fee, while the offer on the screen is today's.
 *
 * Reading the offer through `pausePriceSnapshot` rather than a second price
 * lookup is what keeps the quote and the charge the same number: a price it
 * refuses (archived, $0, no recurrence) is one POST /pause will not swap onto
 * either, so this cannot advertise a pause that would then be declined.
 *
 * Ineligible and not paused answers null and makes no Stripe call. There is no
 * offer to price, and this route renders on every visit to the billing screen.
 *
 * A Stripe failure THROWS rather than degrading to null. Swallowing it would
 * put the screen back in exactly the state this closes — the offer visible with
 * no price beside it — and the handler already round-trips to Stripe for the
 * subscription, so this is the failure surface the route always had.
 */
billingRoutes.get("/pause", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const company = await fetchCompany(db, c.get("companyId"));

  // The schedule gate needs the live subscription; skipped for a company with
  // none, which is the no_subscription answer anyway and saves a round trip on
  // a screen that renders this on every visit.
  let subscription: Stripe.Subscription | null = null;
  if (company.stripe_subscription_id) {
    subscription = await getStripe(env).subscriptions.retrieve(
      company.stripe_subscription_id,
    );
  }
  const eligibility = await pauseEligibility(env, db, company, subscription);
  const offer = eligibility.eligible
    ? await pausePriceSnapshot(env, getStripe(env))
    : null;

  return c.json({
    // A pause we cannot quote is not offered. `pausePriceSnapshot` returns null
    // for a price that would bill NOTHING, and a $0 pause price passes every
    // other guard in this feature — the env var is set, the swap succeeds, the
    // subscription is active — while handing out a held number and a live 10DLC
    // campaign for free. Reporting `eligible` here without the figure would put
    // that button on the screen.
    eligible: eligibility.eligible && offer !== null,
    reason: eligibility.reason ?? (offer === null ? "not_provisioned" : null),
    paused_at: company.paused_at,
    monthly_cents:
      company.paused_at !== null ? company.paused_price_cents : (offer?.cents ?? null),
    // What they come back to. The pause never touches `plan` — that is the
    // whole reason it is not a third plan_id — so this is a real answer even
    // months in.
    resume_plan: company.plan,
  });
});

/**
 * POST /v1/billing/pause (#277) — hold the number, stop the texting.
 *
 * A licensed-price swap on the SAME subscription: the plan's licensed item
 * becomes the pause price and nothing else on the subscription is touched. The
 * 10DLC campaign stays live (deactivating it to save its fee would cost the
 * customer 3-7 business days of US texting on their return, out of a lifetime
 * budget of four reactivations), the numbers stay ours, and the history is
 * never in question.
 *
 * The pause FACT is then mirrored by {@link syncSubscription} — the same
 * function the webhook calls, run here with the truth freshly re-read from
 * Stripe. Calling it rather than writing `paused_at` inline is what keeps one
 * definition of "paused": if this route wrote the column itself, the route and
 * the webhook would be two places that decide, and the day they disagree is the
 * day a workspace is billed for a pause it can still send from.
 */
billingRoutes.post("/pause", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const company = await fetchCompany(db, c.get("companyId"));

  let subscription: Stripe.Subscription | null = null;
  if (company.stripe_subscription_id) {
    subscription = await getStripe(env).subscriptions.retrieve(
      company.stripe_subscription_id,
    );
  }
  const eligibility = await pauseEligibility(env, db, company, subscription);
  if (!eligibility.eligible || !subscription) {
    return errorResponse(c, "conflict", pauseRefusal(eligibility));
  }

  // Read from the CATALOG, not just from the env var. `pauseLicensedPrice` only
  // says an id is configured; this says the id names a price that can charge a
  // monthly amount above zero. A price provisioned at $0 by mistake is a
  // genuinely free pause that nothing else here would catch, and the fee is the
  // entire reason this feature is allowed to exist (a held number plus a live
  // campaign is ~$3/mo of ours). Fail closed on the same reader GET /pause
  // quotes from, so the screen and the button cannot disagree.
  const pausePrice = await pausePriceSnapshot(env, getStripe(env));
  const licensedItem = planLicensedItem(env, subscription);
  if (!pausePrice || !licensedItem) {
    // Not an invariant violation worth a 500: a subscription with no plan
    // licensed item is a subscription mid-something (a schedule that just
    // released, a manual edit in the dashboard), and the useful answer is to
    // try again rather than a stack trace.
    return errorResponse(c, "conflict", "Pausing isn't available right now.");
  }

  await getStripe(env).subscriptions.update(
    subscription.id,
    {
      items: [{ id: licensedItem.id, price: pausePrice.id }],
      proration_behavior: PAUSE_PRORATION,
    },
    {
      // Day-scoped, like the voice-item attach: a retried request within the
      // same day replays rather than swapping twice.
      //
      // AND IT CANNOT TELL A RETRY FROM A SECOND PAUSE. Nothing observable on
      // the subscription distinguishes them — after a resume the licensed item
      // is back on the same id at the same plan price, so pause → resume →
      // pause inside one day sends Stripe a byte-identical request under a key
      // it has already answered, and the cached response comes back with no
      // swap performed. `paused_at` names a pause that exists, so the resume
      // side could key on it (see below); a pause has no such handle before it
      // happens. The re-read after this call is what makes that case honest
      // rather than a 200 for a pause nobody is being charged for.
      idempotencyKey: idempotencyKey(
        company.id,
        "pause",
        `${subscription.id}:${new Date().toISOString().slice(0, 10)}`,
      ),
    },
  );

  // THE SWAP HAS LANDED. From here the workspace is billed the holding fee in
  // Stripe, so anything that leaves `paused_at` unset leaves it texting at full
  // plan quota on a ~$5 line — the cost leak this whole feature is priced
  // against. syncSubscription is the one place that DECIDES the pause fact and
  // it throws on any PostgREST error, so the fallback re-states the same
  // conclusion from the swap we just made rather than deciding a second time,
  // and only when the canonical writer could not run.
  await mirrorAfterSwap(env, db, subscription.id, () =>
    db
      .from("companies")
      .update({ paused_at: new Date().toISOString(), paused_price_cents: pausePrice.cents })
      .eq("id", company.id)
      .is("paused_at", null),
  );

  // Told from the mirror, and REFUSED when the mirror does not agree — the same
  // rule POST /resume follows, for the same reason and one more.
  //
  // The extra reason is the idempotency key above: a replayed pause returns a
  // cached Stripe response, so the licensed item is never swapped, `paused_at`
  // stays null, and every step after the swap still succeeds. Answering 200 with
  // whatever the row happens to say would tell somebody who pressed Pause that
  // they had paused, on a workspace still being billed the full plan price and
  // still able to send. This is the one place that difference is visible.
  const paused = await fetchCompany(db, company.id);
  if (paused.paused_at === null) {
    return errorResponse(
      c,
      "conflict",
      "Your plan hasn't paused yet. If you resumed earlier today, try again " +
        "tomorrow — you won't be charged twice for pausing.",
    );
  }

  await recordAuditFromRequest(db, c, {
    companyId: company.id,
    action: "billing.paused",
    targetType: "company",
    targetId: company.id,
    before: { plan: company.plan, paused: false },
    after: { plan: company.plan, paused: true },
  });

  return c.json({
    paused_at: paused.paused_at,
    monthly_cents: paused.paused_price_cents,
    resume_plan: paused.plan,
  });
});

/**
 * POST /v1/billing/resume (#277) — come back in the spring.
 *
 * The exact inverse: the pause price becomes the plan's licensed price again,
 * on the same item, on the same subscription. Everything else has been sitting
 * where it was left — the number, the campaign, the message history, the
 * scheduled sends that were held rather than failed — so there is nothing to
 * restore and nothing to re-approve.
 *
 * `companies.plan` is where the plan came from, and it has been untouched the
 * whole time. That is the payoff for the pause not being a third plan_id.
 */
billingRoutes.post("/resume", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const company = await fetchCompany(db, c.get("companyId"));

  if (!company.paused_at) {
    return errorResponse(c, "conflict", "Your plan isn't paused.");
  }
  if (!company.stripe_subscription_id || company.plan === null) {
    return errorResponse(c, "conflict", "No subscription to resume.");
  }

  const stripe = getStripe(env);
  const subscription = await stripe.subscriptions.retrieve(
    company.stripe_subscription_id,
  );
  if (subscription.schedule) {
    return errorResponse(
      c,
      "conflict",
      "You have a plan change waiting to take effect. Once it lands you can resume.",
    );
  }

  const pausedItem = pausedLicensedItem(env, subscription);
  if (!pausedItem) {
    // The subscription does not carry the pause price, so there is nothing to
    // swap back — the mirror will clear `paused_at` on its next pass. Telling
    // the customer to try again is better than swapping a line we cannot
    // identify.
    return errorResponse(c, "conflict", "Resuming isn't available right now.");
  }

  await stripe.subscriptions.update(
    subscription.id,
    {
      items: [{ id: pausedItem.id, price: planPrices(env, company.plan).licensed }],
      proration_behavior: PAUSE_PRORATION,
    },
    {
      // Keyed on THE PAUSE BEING LIFTED, not on the calendar day. A day-scoped
      // key made resume → pause → resume inside one day replay the FIRST
      // resume: Stripe returns the cached response, no swap happens, and the
      // customer is told they resumed while they stay paused and unable to
      // send. `paused_at` is stamped once per pause and never walked forward,
      // so it names this pause exactly — a genuine retry of the same resume
      // still replays, which is what stops a second proration.
      idempotencyKey: idempotencyKey(
        company.id,
        "resume",
        `${subscription.id}:${company.paused_at}`,
      ),
    },
  );

  // THE CHARGE HAS HAPPENED. `create_prorations` has just billed the balance of
  // the period back up to the plan price. From here the only acceptable outcomes
  // are "the pause is lifted" or "try again" — never "charged and still
  // blocked", which is what a bare throw out of syncSubscription produced: a
  // 500, a full-price bill, and five SQL send gates still refusing every text.
  //
  // Mirrors `paused_at` back to null, and — because this is the same path the
  // subscription webhook runs — re-points the voice metered item at the resumed
  // plan's price and re-reconciles the modules, with no resume-specific code.
  await mirrorAfterSwap(env, db, subscription.id, () =>
    db
      .from("companies")
      .update({ paused_at: null, paused_price_cents: null })
      .eq("id", company.id),
  );

  // Told from the mirror rather than asserted. A response that says
  // `paused_at: null` because the literal null was typed here is a response that
  // stays right when everything else has gone wrong — and the customer acts on
  // it, believing they can send.
  const resumed = await fetchCompany(db, company.id);
  if (resumed.paused_at !== null) {
    return errorResponse(
      c,
      "conflict",
      "Your plan hasn't come back yet. Give it a minute and try again — you " +
        "won't be charged twice for resuming.",
    );
  }

  // #399/#277: a free month that qualified while this workspace was paused was
  // deliberately NOT applied — it would have been spent on the holding fee
  // instead of the plan month it was earned against. The licensed item is a plan
  // again, so this is the moment it is worth what it was earned for. Never
  // throws: the customer has already been charged for this resume.
  await payPendingReferralRewards(env, db, company.id);

  await recordAuditFromRequest(db, c, {
    companyId: company.id,
    action: "billing.resumed",
    targetType: "company",
    targetId: company.id,
    before: { plan: company.plan, paused: true },
    after: { plan: company.plan, paused: false },
  });

  return c.json({ plan: resumed.plan, paused_at: resumed.paused_at });
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
 * GET /v1/billing/missed-while-off (#490) — how many calls reached this number
 * while it could not take them, and when.
 *
 * The argument for reinstating, with evidence attached. Every one of these is a
 * customer who rang and got nothing; before this the business was never told
 * they had called at all, so the case for coming back was a feeling rather than
 * a number.
 *
 * Its OWN route rather than a field on the company read. The count is an
 * aggregate over the busiest table in the product and the company read is on
 * every screen — paying for this query on every request, for every workspace,
 * to answer a question only a suspended one asks, is the wrong trade. This is
 * fetched by the billing screen when the subscription is not active.
 *
 * Behind this router's `billing.manage` gate like everything else here, so it
 * lands with the person who can act on it — which since #315 includes a
 * bookkeeper, whose whole role is this screen.
 */
billingRoutes.get("/missed-while-off", async (c) => {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");

  // Bounded deliberately. A number left suspended for months would otherwise
  // grow an unbounded count, and "1,400 calls" is not a more persuasive
  // number than "the last 90 days" — it is just an older one, most of which
  // belongs to customers who have long since gone elsewhere.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await db
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("unattended", true)
    .gte("started_at", since);
  if (error) throw new Error(`missed-while-off count failed: ${error.message}`);

  // The most recent one, so the copy can say WHEN rather than only how many.
  // "Someone rang yesterday" is a different sentence from "someone rang in
  // April", and only one of them is worth acting on today.
  const { data: latest, error: latestError } = await db
    .from("calls")
    .select("started_at")
    .eq("company_id", companyId)
    .eq("unattended", true)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1);
  if (latestError) {
    throw new Error(`missed-while-off latest failed: ${latestError.message}`);
  }

  return c.json({
  count: count ?? 0,
  since,
  last_at: latest?.[0]?.started_at ?? null,
  });
});

/**
 * POST /v1/billing/modules (#12 plan builder) — turn a module on/off on an
 * existing subscription. Enabling adds the module's flat line item (prorated
 * now); disabling removes it AND clears any capability it gated (voice →
 * forward + missed-call text) so a switched-off module can never keep costing
 * us. Schedule-aware (#18): with a pending downgrade the change is written
 * into the schedule's phases instead of the raw items. Mirrored to
 * `company_modules`; the subscription webhook re-mirrors too. #277: a PAUSED
 * workspace cannot enable one — see the gate below — but may still disable.
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
  const { module: requestedModule, enabled } = parsed.data;
  // #134 deploy skew: the retired Calling add-on — honest answer, no charge.
  if (requestedModule === "voice") {
    return errorResponse(
      c,
      "conflict",
      "Calling is included on every plan now — there's nothing to turn on or pay for. Reload the app to see the current plan.",
    );
  }
  const module = requestedModule;

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
  /**
   * #277 — a paused workspace does not buy add-ons.
   *
   * NONE of the gates above can see a pause. It is a licensed-PRICE swap, so
   * `subscription_status` stays genuinely 'active' and `plan` stays genuinely
   * populated — both terms of the canceled gate survive it — while the
   * workspace cannot send and cannot dial. The enable path below charges
   * IMMEDIATELY (`always_invoice`), so without this line an owner is billed
   * today, in full, for a capability the pause has switched off, on top of the
   * holding fee they are already paying to be switched off.
   *
   * Refused rather than queued, for the reason `/change-plan` gives above: only
   * the customer can settle whether they mean "resume and add this now" or "add
   * it when I come back", and storing the second is an intention with nowhere
   * to see or cancel it.
   *
   * ONLY THE ENABLE DIRECTION, and that asymmetry is deliberate. A module's
   * line item keeps billing straight through a pause — the swap touches the
   * plan's licensed item and nothing else — so a disable is the customer
   * STOPPING a charge for something they cannot use. Refusing it would answer
   * "resume your plan, at full price, if you want to stop paying for this",
   * which is not a sentence we could defend.
   *
   * AFTER the availability check above, also deliberate. A module we cannot
   * sell here — unsellable, or a price this environment never provisioned — is
   * unbuyable whatever the plan is doing, so leading with the pause would send
   * somebody to resume (a plan month, in real money) to reach a 422.
   *
   * `conflict`, not the `workspace_paused` 402 the numbers and send paths use
   * for the same fact. That code exists so a surface ELSEWHERE in the app can
   * route somebody back to the one button that resumes the plan
   * (packages/shared/src/error-codes.ts); here that button is already on the same
   * screen, and this route's other state refusals are 409s whose sentence the
   * clients render beside the toggle. Matching them keeps the answer a sentence
   * rather than a status a settings screen has never seen from this route.
   */
  if (enabled && company.paused_at) {
    return errorResponse(
      c,
      "conflict",
      `Your plan is paused. Resume it first, then turn on ${MODULE_CATALOG[module].label} — ` +
        "that way you start paying for it on the day you can use it.",
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
      await applyPriceToSchedulePhases(stripe, scheduleId, price, true);
    } else {
      if (!existingItem) {
        await stripe.subscriptionItems.create({
          subscription: subscription.id,
          price,
          proration_behavior: "always_invoice",
        });
      }
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
    // #345: a module is a recurring charge somebody added.
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "billing.module_changed",
      targetType: "company",
      targetId: companyId,
      after: { module, enabled: true },
    });
    return c.json({ module, enabled: true });
  }

  // Disable: drop the line item, mark disabled, and clear the gated
  // capability. (#134: the voice metered item is plan furniture now — it
  // never rides a module toggle.)
  if (scheduleId) {
    await applyPriceToSchedulePhases(stripe, scheduleId, price, false);
  } else {
    if (existingItem) {
      await stripe.subscriptionItems.del(existingItem.id, {
        proration_behavior: "always_invoice",
      });
    }
  }
  const { error } = await db
    .from("company_modules")
    .update({ disabled_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("module", module)
    .is("disabled_at", null);
  if (error) throw new Error(`module disable failed: ${error.message}`);
  // #134: no voice arm — forwarding/MCTB are plan features now, never
  // cleared by a module toggle.
  // #345: and the disable direction, which is the one that removes a
  // capability somebody else may be relying on.
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "billing.module_changed",
    targetType: "company",
    targetId: companyId,
    after: { module, enabled: false },
  });
  return c.json({ module, enabled: false });
});
