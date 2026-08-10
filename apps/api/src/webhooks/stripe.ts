import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";

import { capture } from "../analytics/posthog";
import {
  applyModuleReconcile,
  planModuleReconcile,
  type CompanyModuleRow,
} from "../billing/company-modules";
import {
  isNewCancellation,
  noticeCancellation,
} from "../billing/cancellation-notice";
import { handleChargeDispute } from "../billing/disputes";
import { recordAndSendGraceNotice } from "../billing/grace";
import { idempotencyKey } from "../billing/idempotency";
import {
  allVoiceOveragePrices,
  moduleForPrice,
  modulePrice,
  PLAN_MODULES,
  voiceOveragePrice,
  type PlanModule,
} from "../billing/modules";
import {
  hasLiveSubscription,
  isPauseLicensedPrice,
  mirrorSubscriptionStatus,
  planForLicensedPrice,
  PLAN_LIMITS,
  type LocalSubscriptionStatus,
  type PlanId,
} from "../billing/plans";
import { readPaidCapacityEpoch } from "../billing/extra-numbers";
import {
  billedExtraQuantity,
  claimNumberAllowance,
  heldNoticeNoRecipientsAlert,
  heldNoticeUnannouncedAlert,
  heldNumbersCopy,
  type HeldNumber,
} from "../billing/number-allowance";
import { pushConsequentialNotice } from "../billing/consequential-push";
import {
  ensurePrepaidDiscount,
  grantPrepaidYear,
  isPrepayCheckout,
} from "../billing/prepay";
import { billingRecipients } from "../billing/recipients";
import { getStripe, stripeCryptoProvider, type Stripe } from "../billing/stripe";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import { portDocumentsNeededCopy } from "../telnyx/emails";
import { sendPortEmail, startPortSaga } from "../telnyx/porting";
import {
  closeOutDeadProvisioningBestEffort,
  provisionCompanyNumber,
  suspendCompanyNumbers,
} from "../telnyx/provisioning";
import { submitRegistration } from "../telnyx/registration";
import { enableVoiceForCompany } from "../telnyx/voice";
import { countWebhookRejection } from "../observability/webhook-rejections";
import { processConnectEvent } from "./stripe-connect";

/**
 * Stripe webhook endpoint (SPEC §7 webhook pattern, §9 event table):
 * VERIFY (constructEventAsync + SubtleCryptoProvider on the RAW body) →
 * LEDGER (webhook_events PK dedupe; conflict → ack and stop) →
 * ACK 200 fast → PROCESS in ctx.waitUntil. The 5-minute sweeper cron re-runs
 * rows left with `processed_at IS NULL`. Mounted by the integration layer at
 * /webhooks/stripe — exempt from JWT auth (the signature IS the
 * authentication) and never carries CORS headers.
 */
export const stripeWebhookRoute = new Hono<AppEnv>();

stripeWebhookRoute.post("/", async (c) => {
  const env = getEnv(c.env);

  // 1. VERIFY on the raw body — any re-serialization breaks the signature.
  const rawBody = await c.req.text();
  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ error: "missing stripe-signature header" }, 400);
  }
  /**
   * #224: TWO secrets can sign a delivery here, and both are legitimate.
   *
   * Stripe delivers events about our own account and events about CONNECTED
   * accounts through separate endpoint registrations, each with its own signing
   * secret — even when both point at this URL. The alternative to accepting
   * both is a second route, which would mean a second ledger insert, a second
   * ack path and a second place for the sweeper to look.
   *
   * Order matters only for cost: the platform secret is tried first because it
   * signs the overwhelming majority of deliveries. Neither is skipped, and a
   * signature matching NEITHER is still a rejection — the Connect secret is
   * optional precisely so a deploy that has not configured Connect keeps
   * refusing everything it always refused.
   */
  const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET]
    .filter((secret): secret is string => Boolean(secret));
  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = await getStripe(env).webhooks.constructEventAsync(
        rawBody,
        signature,
        secret,
        undefined, // default 300s tolerance
        stripeCryptoProvider,
      );
      break;
    } catch {
      // Try the next secret; the rejection below is what a total failure means.
    }
  }
  if (!event) {
    // #308: counted. A rotated Stripe secret silently stops every billing
    // state change reaching us, which looks exactly like nobody subscribing.
    countWebhookRejection(c, "stripe");
    return c.json({ error: "signature verification failed" }, 400);
  }

  // 2. LEDGER: INSERT ... ON CONFLICT (provider, event_id) DO NOTHING.
  const db = getDb(env);
  const { data, error } = await db
    .from("webhook_events")
    .upsert(
      {
        provider: "stripe",
        event_id: event.id,
        event_type: event.type,
        payload: event as unknown as Record<string, unknown>,
      },
      { onConflict: "provider,event_id", ignoreDuplicates: true },
    )
    .select("event_id");
  if (error) {
    throw new Error(`webhook_events insert failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    // Conflict → already seen → ack and stop (SPEC §7).
    return c.json({ received: true, duplicate: true });
  }

  // 3. ACK fast; 4. PROCESS in the background.
  c.executionCtx.waitUntil(processAndStamp(env, event));
  return c.json({ received: true });
});

/** Process + ledger bookkeeping (processed_at / attempts / last_error). */
async function processAndStamp(env: Env, event: Stripe.Event): Promise<void> {
  const db = getDb(env);
  try {
    await processStripeEvent(env, event);
    const { error } = await db
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", "stripe")
      .eq("event_id", event.id);
    if (error) {
      throw new Error(`webhook_events stamp failed: ${error.message}`);
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`stripe webhook ${event.id} (${event.type}) failed:`, message);
    const { data } = await db
      .from("webhook_events")
      .select("attempts")
      .eq("provider", "stripe")
      .eq("event_id", event.id)
      .limit(1);
    const attempts = (data?.[0] as { attempts?: number } | undefined)?.attempts ?? 0;
    await db
      .from("webhook_events")
      .update({ attempts: attempts + 1, last_error: message.slice(0, 2000) })
      .eq("provider", "stripe")
      .eq("event_id", event.id);
  }
}

/**
 * The SPEC §9 event→state table. Exported so the §11 webhook-sweeper cron can
 * re-dispatch unprocessed `provider='stripe'` ledger rows through the exact
 * same logic. Handlers treat events as TRIGGERS and re-fetch the subscription
 * from Stripe before applying state (out-of-order guard); every branch is
 * idempotent, so sweeper/waitUntil overlap is harmless.
 */
export async function processStripeEvent(
  env: Env,
  event: Stripe.Event,
): Promise<void> {
  /**
   * #224: an event about somebody ELSE's account, before anything else looks
   * at it.
   *
   * `event.account` is present only on Connect deliveries, and everything below
   * resolves a workspace from a PLATFORM customer id — a different keyspace
   * belonging to a different Stripe account. A connected account's
   * `checkout.session.completed` reaching `handleCheckoutCompleted` would try
   * to provision a subscription from a customer id that is not ours, which is
   * the precise mistake this branch exists to make impossible.
   */
  if (event.account) {
    return processConnectEvent(env, event);
  }

  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(env, event.data.object);
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncSubscription(env, event.data.object.id);
      return;
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(env, event.data.object, event.created);
    case "invoice.paid":
      return handleInvoicePaid(env, event.data.object);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(env, event.data.object);
    case "invoice.payment_action_required":
      return handlePaymentActionRequired(env, event.data.object);
    // #422: a disputed charge was invisible. Stripe leaves the subscription
    // ACTIVE while one of its charges is disputed, so our mirror copied
    // `active` and the service kept running for a customer who had told their
    // bank the charge was wrong. The endpoint was not even subscribed to these.
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      return handleChargeDispute(env, event.data.object, event.type);
    default:
      // Only the SPEC §7 event set is configured on the endpoint; anything
      // else is acked as a no-op.
      return;
  }
}

/** Billing period from the item level (2025-03-31+ API shape). */
function subscriptionPeriod(subscription: Stripe.Subscription): {
  start: string;
  end: string;
} {
  const items = subscription.items.data;
  if (items.length === 0) {
    throw new Error(`Subscription ${subscription.id} has no items.`);
  }
  const start = Math.min(...items.map((item) => item.current_period_start));
  const end = Math.max(...items.map((item) => item.current_period_end));
  return {
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
  };
}

/** The plan whose licensed price is on the subscription (SPEC §9 catalog). */
function subscriptionPlan(
  env: Env,
  subscription: Stripe.Subscription,
): PlanId | null {
  for (const item of subscription.items.data) {
    const plan = planForLicensedPrice(env, item.price.id);
    if (plan) return plan;
  }
  return null;
}

/**
 * #277 — what this subscription says about the pause, read from its licensed
 * item.
 *
 * THREE ANSWERS, NOT TWO, and the third is the important one:
 *
 *   "paused"      the pause price is on the subscription.
 *   "not_paused"  a recognised PLAN licensed price is on it.
 *   "unknown"     neither — so say nothing and leave the stored fact alone.
 *
 * The two-answer version ("is the pause price here? no → clear paused_at") has
 * a failure mode that hands out the product for free: unset
 * STRIPE_PAUSE_PRICE_ID in a deploy — a typo, a secret not carried across, a
 * rolled-back env change — and every paused subscription stops matching, so the
 * next mirror pass would clear `paused_at` on every paused workspace and give
 * them all full service at the holding fee. Silently, on a cron.
 *
 * "unknown" is what makes that impossible. It is the same reasoning as
 * `...(plan ? { plan } : {})` right below, which is why the pause price
 * deliberately does not resolve through planForLicensedPrice: a fact we cannot
 * currently read is not a fact that changed.
 *
 * EXPORTED for the daily reconcile, which already holds every swept customer's
 * subscriptions from one `subscriptions.list` call and can therefore ask what
 * each one says about the pause for free. That check is what makes the
 * "converges within a day" claim on `companies.paused_at` true — see
 * billing/reconcile.ts. It reads only; the WRITE stays in syncSubscription, so
 * this column keeps exactly one writer.
 */
export type PauseReading = "paused" | "not_paused" | "unknown";

export function subscriptionPause(
  env: Env,
  subscription: Stripe.Subscription,
): { reading: PauseReading; priceCents: number | null } {
  for (const item of subscription.items.data) {
    if (item.price && isPauseLicensedPrice(env, item.price.id)) {
      // The fee, from the item we are already holding — no extra Stripe call.
      // `unit_amount` is the price's BASE currency (USD), which is the currency
      // the cost model speaks; null for a tiered price, which nothing sells here.
      return { reading: "paused", priceCents: item.price.unit_amount ?? null };
    }
  }
  for (const item of subscription.items.data) {
    if (item.price && planForLicensedPrice(env, item.price.id)) {
      return { reading: "not_paused", priceCents: null };
    }
  }
  return { reading: "unknown", priceCents: null };
}

/**
 * #17: converge `company_modules` onto the module line items the subscription
 * ACTUALLY carries. Runs from every entry point that mirrors subscription
 * state (checkout completion, subscription created/updated webhooks, and —
 * through syncSubscription — the §11 daily reconcile), so a
 * cancel-then-resubscribe or a schedule rollover can never leave a module
 * enabled that nobody pays for. Grandfathered seed rows are exempt (see
 * planModuleReconcile); disabling voice clears the forwarding config exactly
 * like the manual disable path.
 */
async function reconcileModulesFromSubscription(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  rows: CompanyModuleRow[],
  subscription: Stripe.Subscription,
): Promise<void> {
  const paid = subscription.items.data
    .map((item) => (item.price ? moduleForPrice(env, item.price.id) : null))
    .filter((module): module is PlanModule => module !== null);
  const billable = PLAN_MODULES.filter(
    (module) => modulePrice(env, module) !== null,
  );
  await applyModuleReconcile(
    db,
    companyId,
    planModuleReconcile(rows, paid, billable),
  );
  await ensureVoiceMeteredItem(env, companyId, subscription);
  // #584: and put back a prepaid discount that went missing. D107 requirement 1
  // promised this convergence and it was never built, so destroying paid months
  // took one careless item write while restoring them took a human reading
  // Stripe. Here rather than on a cron of its own, for the reason D107 gave: a
  // cancel-and-resubscribe fires a subscription webhook, so the repair lands in
  // seconds, and the daily reconcile is the backstop that makes "self-heals"
  // true for whatever never produced an event.
  await ensurePrepaidDiscount(env, db, companyId, subscription);

  // #133/#134: every live workspace's numbers must be CALLABLE — calling is
  // included on every plan (D42), so voice binds on every mirror pass of a
  // live subscription, not on any module state. Best-effort — the 15-min
  // reconcileVoiceEnablement cron is the durable retry.
  if (["active", "past_due", "trialing"].includes(subscription.status)) {
    try {
      await enableVoiceForCompany(env, db, companyId);
    } catch (cause) {
      console.error(
        `voice enablement on subscription mirror failed for ${companyId}:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
}

/**
 * D36 review fix, widened by D42 (#134): converge the voice METERED overage
 * item onto EVERY live subscription — calling is included on every plan, so
 * every subscription must carry the CURRENT plan's voice overage price
 * (tier 1 at $0 up to the allowance, then 1¢/min), or minutes would meter
 * but never bill. Runs on every mirror pass (checkout, subscription
 * webhooks, daily reconcile), so drift heals within a day. Skips: non-live
 * subscriptions (Stripe rejects item writes), schedule-managed
 * subscriptions (the schedule owns the items; change-plan writes phases
 * explicitly), unprovisioned price env. Failures are logged, never thrown —
 * a convergence miss retries on the next mirror pass and must not fail the
 * webhook.
 */
export async function ensureVoiceMeteredItem(
  env: Env,
  companyId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  try {
    if (!["active", "past_due", "unpaid", "trialing"].includes(subscription.status)) {
      return;
    }
    if (subscription.schedule) return; // phases own the items (#18)

    const plan = subscriptionPlan(env, subscription);
    // #277 pause — DELIBERATE: the existing voice metered item is KEPT, not
    // dropped. A paused subscription carries no plan licensed price, so `plan`
    // is null here and this returns, leaving whatever voice item was already
    // attached exactly where it was. That is the right arm, and it was chosen
    // rather than inherited:
    //
    //  * DROPPING BUYS NO REVENUE. Tier 1 of the voice metered price is $0 up
    //    to the plan allowance, and a paused workspace cannot place calls
    //    (routes/calls.ts + the runtime's defence-in-depth gate both refuse),
    //    so the item invoices nothing either way. The only thing dropping it
    //    changes is what happens on the way back.
    //  * DROPPING LOSES MONEY AND TIME. Deleting a metered item strands the
    //    seconds already reported against it this period, and re-attaching in
    //    spring is another write that can fail — a wholly avoidable pair of
    //    failure modes in exchange for nothing.
    //  * KEEPING MAKES RESUME A NO-OP. On resume the licensed price swaps back,
    //    `plan` resolves again, and the convergence below re-points the item at
    //    the right plan's price on the very next mirror pass. Resume needs no
    //    voice handling of its own, which is the property worth having.
    if (!plan) return;
    const wanted = voiceOveragePrice(env, plan);
    if (!wanted) return; // not provisioned here — unbilled, never mis-billed

    const voicePrices = new Set(allVoiceOveragePrices(env));
    const existing = subscription.items.data.filter((item) =>
      voicePrices.has(item.price?.id ?? ""),
    );
    const stripe = getStripe(env);
    if (existing.length === 0) {
      await stripe.subscriptionItems.create(
        { subscription: subscription.id, price: wanted },
        {
          // Sub-scoped key: concurrent mirror passes (webhook + confirm race)
          // collapse to one item instead of two prices on one meter.
          idempotencyKey: // #134 review: day+price-scoped so a cached Stripe failure or a
            // plan change never replays a stale result for ~24h.
            idempotencyKey(
              companyId,
              "voice_metered_attach",
              `${subscription.id}:${wanted}:${new Date().toISOString().slice(0, 10)}`,
            ),
        },
      );
      Sentry.captureMessage(
        `voice metered item attached to subscription ${subscription.id} (company ${companyId}) — D36 convergence`,
        "info",
      );
      return;
    }
    const [current, ...extras] = existing;
    if (current.price.id !== wanted) {
      await stripe.subscriptionItems.update(current.id, { price: wanted });
    }
    for (const extra of extras) {
      await stripe.subscriptionItems.del(extra.id, {
        proration_behavior: "always_invoice",
      });
    }
  } catch (cause) {
    Sentry.captureException(cause);
    console.error(
      `voice metered convergence failed for ${companyId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/**
 * #52: insert-first ledger for one-shot customer emails sent from webhook
 * processing. The `webhook_events` ledger dedupes duplicate DELIVERIES, but
 * the sweeper replays a partially-failed handler WHOLE — claiming a
 * `(company_id, email_key)` row before sending means a replay can never
 * re-send an email that already went out. Same insert-first shape as
 * `grace_notices`. Returns whether THIS call claimed the key.
 */
async function claimEmailOnce(
  db: SupabaseClient,
  companyId: string,
  emailKey: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("email_ledger")
    .upsert(
      { company_id: companyId, email_key: emailKey },
      { onConflict: "company_id,email_key", ignoreDuplicates: true },
    )
    .select("email_key");
  if (error) throw new Error(`email_ledger insert failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Give a claimed key back when the send it was claiming never left the building.
 *
 * The insert-first ledger is what makes a sweeper replay unable to send an email
 * twice, and that is exactly right for a send that HAPPENED. It is exactly wrong
 * for one that did not: Resend has an outage, the send throws, and the key is
 * already spent — so every later replay skips the notice and the owner is never
 * told. At-most-once quietly became never.
 *
 * Releasing the key trades a guarantee we cannot keep for one we can. The worst
 * case is a duplicate notice about a number that really is on hold; the case it
 * prevents is silence about it. And the trade is cheaper than it looks: the
 * push never throws (`pushConsequentialNotice` swallows its own failures), so
 * everything that reaches this point failed BEFORE Resend accepted anything —
 * bar the one narrow case of a send that landed and whose response was lost.
 *
 * Best-effort by construction — the send has already failed, and a failed
 * clean-up must not become the caller's error.
 */
async function releaseEmailClaim(
  db: SupabaseClient,
  companyId: string,
  emailKey: string,
): Promise<void> {
  try {
    const { error } = await db
      .from("email_ledger")
      .delete()
      .eq("company_id", companyId)
      .eq("email_key", emailKey);
    if (error) throw new Error(error.message);
  } catch (cause) {
    console.error(
      `email_ledger release failed for ${companyId} (${emailKey}):`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/**
 * #523: tell the owner that a number came back HELD rather than live.
 *
 * A held number is the weakest part of this whole answer and it is only
 * defensible if the owner is told at the moment it happens. It keeps receiving
 * texts and answering calls with the #490 unavailable notice, so the customer's
 * customers keep reaching a number the business cannot work — and without this
 * they find out before the owner does.
 *
 * Both channels, for the same reason the grace warnings use both (#252): this
 * is a consequential notice about the phone number their business runs on, and
 * an email that lands in spam is a warning nobody saw. The push is best-effort
 * and never throws.
 *
 * Ledgered on the CHECKOUT SESSION, not the company: the webhook, the
 * confirm-checkout poller and a sweeper replay of a half-finished handler all
 * reach this for the same session, and only one of them may send. A LATER
 * resubscribe is a different session and is told again, which is right — it is
 * a different decision with a different set of numbers.
 *
 * The push goes out only when the email was claimed by THIS call, so the two
 * channels can never disagree about how many times the owner was told.
 *
 * A FAILED SEND GIVES THE KEY BACK. See {@link releaseEmailClaim}: without it a
 * Resend outage spends the one chance to tell somebody their number is on hold.
 */
async function noticeHeldNumbers(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    plan: PlanId;
    allowance: number;
    held: HeldNumber[];
    emailKey: string;
  },
): Promise<void> {
  if (!(await claimEmailOnce(db, args.companyId, args.emailKey))) return;

  try {
    const { data, error } = await db
      .from("companies")
      .select("name")
      .eq("id", args.companyId)
      .limit(1);
    if (error) throw new Error(`company name lookup failed: ${error.message}`);
    const companyName =
      (data?.[0] as { name?: string } | undefined)?.name ?? "your workspace";

    const billing = `${env.APP_ORIGIN}/settings/billing`;
    const { subject, text } = heldNumbersCopy({
      companyName,
      plan: args.plan,
      allowance: args.allowance,
      held: args.held,
    });
    const to = await billingRecipients(env, args.companyId, db);
    if (to.length === 0) {
      // #526: silent by construction until now. Nothing is sent and nothing is
      // thrown, so the catch below never runs and the ledger key is spent on a
      // notice that had nowhere to go. The push still fires (its audience is
      // user ids, not addresses) — but the channel we treat as the durable one
      // did not, and that has to be on the record.
      Sentry.captureMessage(
        heldNoticeNoRecipientsAlert({
          companyId: args.companyId,
          held: args.held.length,
        }),
        "error",
      );
    } else {
      await sendEmail(env, {
        to,
        subject,
        // The copy ends on the routes back; the link is appended here because the
        // billing screen is where both of them start.
        text: `${text}${billing}\n\nLoonext`,
        // renderEmailHtml escapes — companyName is customer-controlled input.
        html: renderEmailHtml(`${text}${billing}\n\nLoonext`),
        critical: true,
      });
    }

    await pushConsequentialNotice(env, db, {
      companyId: args.companyId,
      title: subject,
      body: "Open Loonext to see which number, and how to bring it back.",
      path: "/settings/billing",
      collapseKey: `numbers_held:${args.companyId}`,
    });
  } catch (cause) {
    await releaseEmailClaim(db, args.companyId, args.emailKey);
    throw cause;
  }
}

/**
 * A completed Checkout session that should provision the company: a real
 * payment ('paid'), OR a $0 session from a 100%-off coupon, which Stripe
 * reports as 'no_payment_required' (comp / free accounts). Both create the
 * subscription + customer and fire checkout.session.completed identically.
 */
export function isProvisionableCheckout(
  session: Stripe.Checkout.Session,
): boolean {
  return (
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required"
  );
}

/**
 * §9 `checkout.session.completed` row: provisions on paid OR $0-coupon
 * ('no_payment_required'); `incomplete → active`; store customer/subscription/plan/period; stamp
 * `registration_fee_paid_at` when the fee line is present; un-suspend numbers
 * (resubscribe-within-grace); start the provisioning saga — the saga's
 * `provisioning_key` (= this checkout session id) is the ordering backstop —
 * and submit the 10DLC registration (§4.1 step 5c): R1 for first payments
 * (the checkout gate guarantees a complete draft for every company that owes
 * US registration) and the §4.4 campaign reactivation for post-grace
 * resubscribes; CA companies with US texting off are a no-op inside
 * submitRegistration.
 */
export async function handleCheckoutCompleted(
  env: Env,
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (!isProvisionableCheckout(session)) return; // §9 guard — ack as no-op

  // #400/D107: a prepaid year is a one-time payment session, so it carries NO
  // subscription reference and would fall into the throw below — which the
  // sweeper would then retry every five minutes forever, with a Sentry alert
  // each time. Branch before that, on OUR metadata rather than on `mode`: mode
  // alone would also claim any future one-time session this product grows, and
  // the failure of guessing wrong here is silent money movement.
  if (isPrepayCheckout(session)) {
    const result = await grantPrepaidYear(env, getDb(env), session);
    if (result.outcome !== "granted") {
      console.log(`prepaid year ${session.id}: ${result.outcome}, no change made`);
    }
    return;
  }

  const companyId = session.client_reference_id;
  if (!companyId) {
    throw new Error(`Checkout session ${session.id} has no client_reference_id.`);
  }
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  if (!subscriptionId || !customerId) {
    throw new Error(
      `Checkout session ${session.id} lacks subscription/customer references.`,
    );
  }

  const stripe = getStripe(env);
  const db = getDb(env);
  // #110/#523 ORDER MATTERS: the raise fence is read BEFORE the subscription
  // snapshot below, because that snapshot is the billed conclusion it fences.
  // Any capacity credit that lands in between bumps the epoch, and the
  // allowance claim then refuses to raise capacity from a figure that predates
  // it — holding one number more rather than handing out a free one.
  const capacityEpoch = await readPaidCapacityEpoch(db, companyId);
  // Re-fetch guard: mirror the subscription's CURRENT truth, not the event's.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const status = mirrorSubscriptionStatus(subscription.status) ?? "active";
  const period = subscriptionPeriod(subscription);
  const plan = subscriptionPlan(env, subscription);

  // A checkout session stays "paid" forever, so replaying an old one must not
  // be able to resurrect a subscription Stripe has since ended. The activation
  // claim clears `canceled_at` unconditionally, and that column IS the grace
  // clock: nulling it drops the company out of the daily grace scan for good,
  // so the release never runs, the customer is never warned their number is
  // going, and the number rent plus the monthly campaign fee bill a churned
  // tenant forever. Nothing re-stamps it either, because the subscription
  // deleted event fires once and the daily reconcile skips canceled companies.
  //
  // Reachable without a webhook at all: the setting-up page polls
  // confirm-checkout every few seconds for anyone sitting on a bookmarked
  // ?checkout=success URL.
  if (status === "canceled") return;

  // #526 — close out the rows that never became a number, HERE, while the
  // workspace is still `canceled`.
  //
  // ORDER IS THE WHOLE POINT, and it is why this sits above the activation
  // claim rather than beside the allowance claim below. The close-out is
  // deliberately refused for a live workspace (a `provisioning` row there is a
  // purchase in flight, not a ghost — see the migration), and the claim on the
  // next line is what flips this workspace to `active`. One line later and
  // this is a no-op.
  //
  // The cancellation webhook and the daily grace job both do this already, so
  // in the common case it finds nothing. What it closes is the last window
  // neither of them can: a saga that recorded its failure a second after the
  // cancellation, on a workspace that came back before the next daily pass.
  // That window matters more than its width, because everything downstream on
  // this path is decided by counting rows — `claimNumberAllowance` settles the
  // hold against every row that is not `released`, and `provisionCompanyNumber`
  // skips the buy entirely when it finds a row under a foreign provisioning
  // key. A ghost left standing here does not just cost a slot; for a workspace
  // whose FIRST provisioning is what failed, it is the reason coming back buys
  // them no number at all.
  //
  // Best-effort, like its other two callers: nothing about a customer paying us
  // to come back should fail because a tidy-up could not run.
  await closeOutDeadProvisioningBestEffort(db, companyId, `checkout ${session.id}`);

  // §9 double-charge fail-safe: attach EXACTLY ONE live subscription per company,
  // atomically (row-locked conditional claim). Two checkout completions — a raced
  // second checkout — used to both run this activation as an UNCONDITIONAL
  // overwrite: last-write-wins attached the second subscription and orphaned the
  // first, which then billed the founder forever, invisibly.
  //
  // #277: the claim ALSO clears `paused_at`/`paused_price_cents` when `p_plan`
  // names a plan, and this handler deliberately does NOT call syncSubscription
  // to do it. A workspace that paused, then cancelled, then resubscribed used to
  // come back active on a plan price with the pause fact still set: blocked in
  // every gate while paying full price, with no self-serve exit (pause refuses
  // `already_paused`, change-plan refuses, resume 409s because the new
  // subscription carries no pause item to swap back). The clear belongs inside
  // the claim because the claim is the atomic attach: a mirror call afterwards
  // leaves a window where the company is active-on-plan and still blocked, and
  // anything that ends the request there — a CPU limit, a deploy, the sweeper
  // giving up after five attempts — puts the customer back in a state they
  // cannot leave. 20260805080000_resubscribe_clears_pause.sql argues it in full.
  const { data: claim, error: claimError } = await db.rpc(
    "claim_checkout_activation",
    {
      p_company_id: companyId,
      p_customer_id: customerId,
      p_subscription_id: subscriptionId,
      p_status: status,
      p_period_start: period.start,
      p_period_end: period.end,
      p_cancel_at_period_end: subscription.cancel_at_period_end === true,
      p_plan: plan ?? null,
    },
  );
  if (claimError) {
    throw new Error(`checkout activation claim failed: ${claimError.message}`);
  }
  const claimResult = claim as {
    outcome?: string;
    existing_subscription_id?: string | null;
    modules?: CompanyModuleRow[];
  } | null;
  if (claimResult?.outcome === "duplicate") {
    // A DIFFERENT live subscription already owns this company — this completion is
    // a raced duplicate. Cancel THIS subscription so it never bills, and do NOT
    // provision (the winning session owns the number). Best-effort cancel: a
    // failure is logged so the subscription reconcile / an operator can reclaim it.
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (cancelError) {
      Sentry.captureException(cancelError);
    }
    Sentry.captureMessage(
      `checkout: duplicate subscription ${subscriptionId} for company ${companyId} cancelled — a live subscription (${claimResult.existing_subscription_id ?? "?"}) already exists`,
      "warning",
    );
    return;
  }
  // 'claimed' (fresh, or replacing a dead sub on resubscribe) or 'noop' (the
  // confirm-checkout vs webhook double-fire on the SAME session): the activation
  // is applied and every step below is idempotent. The claim returns the
  // company_modules truth alongside it (as the old embedded activation select did).
  const moduleRows = claimResult?.modules ?? [];

  // $29 US-registration fee line present → stamp, once per company ever.
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 100,
  });
  const feeLinePresent = lineItems.data.some(
    (line) => line.price?.id === env.STRIPE_US_FEE_PRICE_ID,
  );
  if (feeLinePresent) {
    const { error: feeError } = await db
      .from("companies")
      .update({ registration_fee_paid_at: new Date().toISOString() })
      .eq("id", companyId)
      .is("registration_fee_paid_at", null);
    if (feeError) {
      throw new Error(`registration fee stamp failed: ${feeError.message}`);
    }
  }

  // #12/#17 plan builder: RECONCILE company_modules to the subscription's
  // actual module line items, derived from the re-fetched subscription so a
  // redelivery converges on the same set. Enables what is paid for and — the
  // #17 fix — disables what is not: a cancel-then-resubscribe-base-only used
  // to keep every add-on (and the voice forwarding config) active for $0,
  // forever. Grandfathered seed rows are the one deliberate exemption.
  await reconcileModulesFromSubscription(
    env,
    db,
    companyId,
    moduleRows,
    subscription,
  );

  if (status === "active") {
    // §12 step 18 north-star: the company just flipped active on a paid
    // checkout. distinct_id = company_id, plan is safe metadata (no PII,
    // SPEC §10). Best-effort — a rare sweeper re-run of a half-processed
    // event may re-fire, which PostHog funnels absorb (first occurrence
    // per distinct_id counts).
    await capture(env, "checkout_completed", companyId, { plan });

    // Resubscribe-within-grace: un-suspend instead of provisioning (§9) —
    // the saga then skips because a non-released number exists.
    //
    // #523: bounded by the plan they just bought. This used to be one
    // unfiltered UPDATE, so a Pro workspace holding two numbers that came back
    // on Starter came back holding two — never billed for the second (the
    // convergence is down-only by design, #105) and never reclaimed (the grace
    // job only scans cancelled companies), so we paid its rent forever.
    //
    // Nothing here can refuse the resubscribe: the money has already moved and
    // this claim has no failing branch. What it decides is only which of the
    // numbers come back now, and it releases none of them — see
    // billing/number-allowance.ts.
    const allowance = await claimNumberAllowance(db, {
      companyId,
      // Null when the licensed price is not in this deploy's catalog. The claim
      // then restores everything, exactly as the old statement did: a price id
      // we cannot read is not a statement about how many numbers a paying
      // customer may hold.
      included: plan ? PLAN_LIMITS[plan].numbers : null,
      // What this subscription actually bills for extras. A fresh checkout
      // session carries no extra-number line — #523 decided against adding one,
      // because it would make the win-back cost more than the button that opened
      // it — so this is the write that finally clears the capacity a DEAD
      // subscription left behind, spendable for free on the port and
      // text-enablement paths until now.
      paidExtras: plan ? billedExtraQuantity(env, subscription, plan) : 0,
      expectedEpoch: capacityEpoch,
    });
    if (allowance.capacityFenced) {
      Sentry.captureMessage(
        `checkout ${session.id}: paid-extra capacity raise fenced for company ${companyId} — a credit landed mid-activation; the next reconcile re-mirrors`,
        "warning",
      );
    }
    if (allowance.held.length > 0 && plan) {
      // BEST-EFFORT, like every other side effect on this path that is not the
      // provisioning itself (the voice-metered convergence above, the duplicate
      // subscription cancel below). A notice is how somebody LEARNS about the
      // hold; it is not how the hold is applied, and it must never be the reason
      // a customer who just paid to come back is left without a working number.
      //
      // It sits before the port start, the number provisioning and the §4.4
      // campaign reactivation — so an unguarded throw here meant a Resend outage
      // stopped a post-grace resubscriber from being able to text at all, and
      // the sweeper's replay skipped the notice anyway (the ledger key was
      // already spent), which is how the hold ended up costing us silently.
      //
      // Loud, though. The claim is given back so a replay can try again, and
      // Sentry hears about it either way.
      try {
        await noticeHeldNumbers(env, db, {
          companyId,
          plan,
          allowance: allowance.allowance ?? PLAN_LIMITS[plan].numbers,
          held: allowance.held,
          // One notice per checkout session: the webhook, the confirm-checkout
          // poller and a sweeper replay all reach this line for the same session.
          emailKey: `numbers_held:${session.id}`,
        });
      } catch (cause) {
        Sentry.captureException(cause);
        Sentry.captureMessage(
          heldNoticeUnannouncedAlert({
            companyId,
            sessionId: session.id,
            held: allowance.held.length,
          }),
          "error",
        );
        console.error(
          `held-number notice failed for ${companyId} (${session.id}):`,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    }

    // PORTING.md §0/§4/D16: a port is a PARALLEL branch of this same paid
    // trigger — pay first, then port. If the company has a pending port
    // (row inserted with source='ported', status='provisioning' at
    // POST /v1/port-requests), the paid webhook starts the port saga instead
    // of buying that number. provisionCompanyNumber below then skips it (a
    // non-released ported number already exists), so the ported number is
    // never double-provisioned; only an opted-in bridge number is bought.
    await startPendingPorts(env, db, companyId, session.id);

    await provisionCompanyNumber(env, {
      companyId,
      checkoutSessionId: session.id,
    });
    // §4.1 step 5c / §9: submit the 10DLC registration. Idempotent (already
    // in-flight/approved registrations no-op), so redelivery and the sweeper
    // cron are harmless; a Telnyx failure propagates to the webhook ledger
    // (attempts + last_error) and the sweeper retries the submission.
    await submitRegistration(env, companyId);
  }
}

/**
 * PORTING.md §4/§8.1: drive every `draft` port for the company from the paid
 * checkout webhook (parallel to provisioning). This CREATES the Telnyx porting
 * order (draft) but does NOT confirm it — confirmation is the documents-gated
 * post-payment step (POST /:id/submit) the customer triggers after uploading
 * the LOA + invoice, since those can only be attached once the subscription is
 * active. Idempotent — startPortSaga skips completed steps on persisted order
 * ids, and a duplicate delivery re-runs a still-draft row harmlessly. A bridge
 * number (wants_bridge_number) is a normal provisioned number bought via the
 * existing saga under its own provisioning key (the port's own row is
 * source='ported' and never bought here).
 */
async function startPendingPorts(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  checkoutSessionId: string,
): Promise<void> {
  // Widened to `string` on purpose: supabase-js's literal column parser trips
  // on this list; the row shape is asserted by the cast below.
  const portColumns: string =
    "id,phone_e164,wants_bridge_number,bridge_number_id," +
    "telnyx_loa_document_id,telnyx_invoice_document_id";
  const { data, error } = await db
    .from("port_requests")
    .select(portColumns)
    .eq("company_id", companyId)
    .eq("status", "draft");
  if (error) throw new Error(`port_requests lookup failed: ${error.message}`);
  const ports = (data ?? []) as unknown as {
    id: string;
    phone_e164: string;
    wants_bridge_number: boolean;
    bridge_number_id: string | null;
    telnyx_loa_document_id: string | null;
    telnyx_invoice_document_id: string | null;
  }[];

  for (const port of ports) {
    // Opt-in tide-me-over number: a normal provisioned number via the existing
    // saga, keyed distinctly so it never collides with the port row or the
    // initial provisioning key. `bridge: true` tells the saga's foreign-row
    // guard to ignore the port's own source='ported' row (which always exists
    // here) while keeping the provisioning_key idempotency — duplicate
    // deliveries converge on ONE bridge row. provisionCompanyNumber records
    // saga-step failures on the phone_numbers row (never throws for those);
    // only infra failures propagate, and those belong on the webhook ledger
    // to retry.
    if (port.wants_bridge_number && !port.bridge_number_id) {
      const bridge = await provisionCompanyNumber(env, {
        companyId,
        checkoutSessionId: `${checkoutSessionId}:bridge:${port.id}`,
        bridge: true,
      });
      // Persist the port ↔ bridge link (SET NULL FK) the moment the row
      // exists — a provision_failed bridge is retried by the §11 cron under
      // this SAME row, so linking early never dangles. The is-null guard
      // keeps a sweeper/waitUntil overlap from re-linking.
      if (bridge) {
        const { error: linkError } = await db
          .from("port_requests")
          .update({ bridge_number_id: bridge.id })
          .eq("id", port.id)
          .is("bridge_number_id", null);
        if (linkError) {
          throw new Error(`bridge number link failed: ${linkError.message}`);
        }
      }
    }
    await startPortSaga(env, { companyId, portRequestId: port.id });

    // The transfer is documents-gated (§3.5) and the LOA + bill can only be
    // uploaded now that the subscription is active — tell the customer their
    // ONE next step, or a port-only signup sits waiting on documents nobody
    // asked for. Skipped when both documents are already on file. #52: the
    // webhook ledger only dedupes duplicate deliveries — a sweeper replay of
    // this handler (after a later Telnyx step failed) re-runs the whole thing,
    // so the nudge is claimed through the email_ledger first and sends exactly
    // once per port request.
    if (!port.telnyx_loa_document_id || !port.telnyx_invoice_document_id) {
      const claimed = await claimEmailOnce(
        db,
        companyId,
        `port_documents_needed:${port.id}`,
      );
      if (claimed) {
        await sendPortEmail(
          env,
          db,
          companyId,
          portDocumentsNeededCopy(port.phone_e164, env),
        );
      }
    }
  }
}

/**
 * §9 `customer.subscription.created`/`updated` row: re-fetch, then mirror
 * status + plan + period. A no-match update (event racing ahead of the
 * checkout handler stamping `stripe_subscription_id`) is a harmless no-op —
 * the checkout handler and the daily reconcile cron converge the state.
 * Exported for the §11 daily subscription-reconcile cron
 * (src/billing/reconcile.ts), which re-mirrors non-active companies through
 * this exact same re-fetch path.
 *
 * Beyond the plain mirror, this path also converges the two lifecycles that
 * used to depend on a specific event arriving:
 * - live subscription → #17 module reconcile (see
 *   reconcileModulesFromSubscription);
 * - canceled subscription → #21 the SAME grace/suspend machinery the
 *   `customer.subscription.deleted` handler runs. Without this, a missed
 *   deletion webhook left the daily reconcile mirroring 'canceled' while the
 *   30-day grace clock never started — the Telnyx number and 10DLC campaign
 *   billed the founder forever and the customer never heard a word.
 */
export async function syncSubscription(
  env: Env,
  subscriptionId: string,
  db: SupabaseClient = getDb(env),
): Promise<{ id: string; name: string; status: LocalSubscriptionStatus }[]> {
  const subscription = await getStripe(env).subscriptions.retrieve(
    subscriptionId,
  );
  const status = mirrorSubscriptionStatus(subscription.status);
  if (status === null) return []; // unmappable (paused) — leave state alone

  const period = subscriptionPeriod(subscription);
  const plan = subscriptionPlan(env, subscription);
  const pause = subscriptionPause(env, subscription);
  // #421: read BEFORE the mirror overwrites it. A portal cancellation arrives
  // as `cancel_at_period_end` newly true, and every later update repeats it —
  // comparing against what we already hold is what makes the owner's notice
  // fire once instead of on every card touch.
  const newCancellation = await isNewCancellation(db, subscriptionId, subscription, status);
  const { data, error } = await db
    .from("companies")
    .update({
      subscription_status: status,
      current_period_start: period.start,
      current_period_end: period.end,
      // §9: "handle cancel_at_period_end display" — a portal cancellation
      // scheduled for period end is mirrored so the UI can announce it. Once
      // the subscription IS canceled the pending flag is moot (§9 deleted
      // row) and is forced off so the UI never announces a pending
      // cancellation on a dead subscription.
      cancel_at_period_end:
        status !== "canceled" && subscription.cancel_at_period_end === true,
      ...(plan ? { plan } : {}),
    })
    .eq("stripe_subscription_id", subscriptionId)
    // company_modules embedded so the #17 reconcile needs no second read;
    // canceled_at feeds the #21 missed-cancellation backstop.
    // #277: paused_at + paused_price_cents ride along so the pause convergence
    // below can tell "already correct" from "needs a write" without a read of
    // its own — see the note there for why that distinction matters.
    .select("id,name,owner_user_id,canceled_at,paused_at,paused_price_cents,company_modules(module,disabled_at,grandfathered)");
  if (error) throw new Error(`subscription mirror failed: ${error.message}`);
  const companies = (data ?? []) as {
    id: string;
    name: string;
    owner_user_id: string;
    canceled_at: string | null;
    paused_at: string | null;
    paused_price_cents: number | null;
    company_modules?: CompanyModuleRow[];
  }[];

  /**
   * #277 — the pause fact, converged from the subscription's own licensed item.
   *
   * NOT folded into the mirror update above, and WRITTEN ONLY WHEN IT CHANGES.
   *
   * Not folded in, because the DATE must be stamped once: "paused since 4
   * November" is shown to the customer, and this function re-mirrors every
   * subscription daily as well as on every Stripe event, so an unconditional
   * write would walk that date forward forever.
   *
   * Written only on a change, because the alternative is a second PATCH against
   * `companies` on EVERY mirror pass for every workspace in the product — a
   * doubling of the write traffic on the hottest billing path, to store a value
   * that is already correct. The rows the update just returned carry the current
   * values, so the comparison is free.
   *
   * A failure THROWS rather than being swallowed. This is a send gate: a
   * workspace whose pause never landed keeps texting on a holding fee, and the
   * webhook sweeper retrying in five minutes is the correct outcome.
   */
  //
  // Every comparison below coalesces `undefined` to null. A row that predates
  // the column — or any future caller whose select drops it — reads undefined,
  // and both branches then fail in the SAFE direction: the pause branch stamps
  // (blocking sends), and the resume branch writes nothing (leaving the
  // workspace blocked until somebody notices). The unsafe direction, a workspace
  // silently un-paused into full service on a holding fee, is unreachable.
  if (pause.reading === "paused") {
    if (companies.some((company) => (company.paused_at ?? null) === null)) {
      const { error: pausedError } = await db
        .from("companies")
        .update({ paused_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subscriptionId)
        .is("paused_at", null);
      if (pausedError) throw new Error(`pause mirror failed: ${pausedError.message}`);
    }
    // The fee converges separately: the founder can reprice the pause, and the
    // #85 cost-vs-revenue projection reads this column to value a paused tenant.
    if (
      companies.some(
        (company) => (company.paused_price_cents ?? null) !== pause.priceCents,
      )
    ) {
      const { error: feeError } = await db
        .from("companies")
        .update({ paused_price_cents: pause.priceCents })
        .eq("stripe_subscription_id", subscriptionId);
      if (feeError) throw new Error(`pause fee mirror failed: ${feeError.message}`);
    }
  } else if (
    pause.reading === "not_paused" &&
    companies.some(
      (company) =>
        (company.paused_at ?? null) !== null ||
        (company.paused_price_cents ?? null) !== null,
    )
  ) {
    const { error: resumeError } = await db
      .from("companies")
      .update({ paused_at: null, paused_price_cents: null })
      .eq("stripe_subscription_id", subscriptionId);
    if (resumeError) throw new Error(`resume mirror failed: ${resumeError.message}`);
  }
  // pause.reading === "unknown" writes nothing at all — see subscriptionPause.

  // #327: the cohort anchor for D12's week-4 retention target. Stamped ONCE,
  // guarded on null, from Stripe's own `start_date` rather than from now() — a
  // replayed webhook (and this one is replayed often, by the daily reconcile as
  // well as by Stripe) must never move a workspace into a different cohort.
  //
  // No column held this before: `created_at` is signup rather than payment, and
  // `current_period_start` advances every month, so neither can anchor a
  // cohort. Best-effort and after the mirror: retention reporting must never be
  // the reason an account's real state fails to land.
  if (hasLiveSubscription(status) && subscription.start_date) {
    const startedAt = new Date(subscription.start_date * 1000).toISOString();
    const { error: anchorError } = await db
      .from("companies")
      .update({ subscription_started_at: startedAt })
      .eq("stripe_subscription_id", subscriptionId)
      .is("subscription_started_at", null);
    if (anchorError) {
      console.error(
        `subscription_started_at stamp failed for ${subscriptionId}:`,
        anchorError.message,
      );
    }
  }

  // #421: an irreversible clock just started on this company's phone number
  // and nothing told the person who owns it. Best-effort — the mirror is the
  // truth of the account and must never fail because a courtesy email did.
  if (newCancellation) {
    for (const company of companies) {
      await noticeCancellation(env, db, company, subscription);
    }
  }

  if (status === "canceled") {
    for (const company of companies) {
      await startCancellationLifecycle(env, db, company, subscription);
    }
  } else if (hasLiveSubscription(status)) {
    for (const company of companies) {
      await reconcileModulesFromSubscription(
        env,
        db,
        company.id,
        company.company_modules ?? [],
        subscription,
      );
    }
  }
  // Expose the mirrored (truth) status so callers can gate on it — e.g. the
  // dunning email must not fire when an out-of-order success left this active.
  return companies.map(({ id, name }) => ({ id, name, status }));
}

/**
 * The ONE cancellation entry point (§9 deleted row / #21 reconcile backstop):
 * claim `canceled_at`, suspend the numbers, start the grace clock with the
 * day-1 notice. Every step is idempotent — the claim is guarded on
 * `canceled_at IS NULL` (first writer wins; the grace ledger keys on the one
 * stored value), number suspension only touches `status='active'` rows, and
 * the day-1 email rides the `grace_notices` insert-first ledger — so the
 * daily reconcile re-running this for an already-canceled company converges
 * instead of duplicating.
 */
async function startCancellationLifecycle(
  env: Env,
  db: SupabaseClient,
  company: { id: string; name: string; canceled_at: string | null },
  subscription: Stripe.Subscription,
  fallbackEpochSeconds?: number,
): Promise<void> {
  let canceledAt = company.canceled_at;
  if (!canceledAt) {
    // Stripe carries the authoritative cancellation moment on the
    // subscription itself; the event-timestamp fallback only matters for
    // payloads that predate it, and drifting late merely shortens grace by
    // the delivery lag.
    const epochSeconds =
      subscription.canceled_at ??
      subscription.ended_at ??
      fallbackEpochSeconds ??
      Math.floor(Date.now() / 1000);
    const claim = new Date(epochSeconds * 1000).toISOString();
    const { data, error } = await db
      .from("companies")
      .update({ canceled_at: claim })
      .eq("id", company.id)
      .is("canceled_at", null)
      .select("id");
    if (error) throw new Error(`canceled_at claim failed: ${error.message}`);
    if ((data ?? []).length > 0) {
      canceledAt = claim;
    } else {
      // Lost the claim to a concurrent delivery — read the persisted truth so
      // the grace ledger keys on the ONE stored value (never double-sends).
      const { data: current, error: readError } = await db
        .from("companies")
        .select("canceled_at")
        .eq("id", company.id)
        .limit(1);
      if (readError) {
        throw new Error(`canceled_at read failed: ${readError.message}`);
      }
      canceledAt =
        ((current ?? [])[0] as { canceled_at: string | null } | undefined)
          ?.canceled_at ?? claim;
    }
  }

  await suspendCompanyNumbers(env, company.id);
  await recordAndSendGraceNotice(
    env,
    { id: company.id, name: company.name, canceled_at: canceledAt },
    1,
  );
}

/**
 * §9 `customer.subscription.deleted` row: `→ canceled`, `canceled_at` set,
 * numbers suspended (inbound still received), grace clock starts, day-1
 * warning sent through the `grace_notices` ledger (shared with the §11 cron,
 * so overlap can never double-send). Runs the SAME
 * startCancellationLifecycle the #21 reconcile backstop uses: `canceled_at`
 * derives from the subscription's own `canceled_at` (falling back to the
 * event timestamp), and the first-writer-wins claim means a late deleted
 * delivery after a reconcile-claimed cancellation converges on the one
 * stored value instead of re-keying the grace ledger.
 */
async function handleSubscriptionDeleted(
  env: Env,
  subscription: Stripe.Subscription,
  eventCreated: number,
): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db
    .from("companies")
    .update({
      subscription_status: "canceled",
      // The pending-cancellation flag is moot once the deletion lands —
      // `subscription_status='canceled'` + `canceled_at` are the truth now.
      cancel_at_period_end: false,
    })
    .eq("stripe_subscription_id", subscription.id)
    .select("id,name,canceled_at");
  if (error) throw new Error(`cancellation mirror failed: ${error.message}`);
  const company = (data ?? [])[0] as
    | { id: string; name: string; canceled_at: string | null }
    | undefined;
  if (!company) return; // unknown subscription — nothing of ours to cancel

  await startCancellationLifecycle(env, db, company, subscription, eventCreated);
  await confirmCancellationReason(db, company.id);
}

/**
 * #277 — stamp the reason they gave BEFORE the handoff, now that they have
 * actually gone.
 *
 * The row is written when somebody opens the cancel screen and says why, which
 * is the only moment they will still answer. Saying why is not leaving, so an
 * unstamped row means somebody told us their reason and then stayed. That is
 * the number any retention offer has to be measured against, and collapsing the
 * two - by writing the row only here - would throw it away.
 *
 * Best-effort and never throws. The cancellation itself is already mirrored and
 * the grace clock already started; losing a report field must not wedge a
 * webhook Stripe will retry.
 */
async function confirmCancellationReason(
  db: ReturnType<typeof getDb>,
  companyId: string,
): Promise<void> {
  try {
    const { error } = await db
      .from("cancellation_reasons")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .is("confirmed_at", null);
    if (error) throw new Error(error.message);
  } catch (cause) {
    // Never-silent (D3), non-fatal.
    console.error(
      `cancellation reason confirm failed (${companyId}): ${String(cause)}`,
    );
  }
}

/** Subscription reference from a Dahlia-shape invoice (parent details). */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const ref = invoice.parent?.subscription_details?.subscription;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * §9 `invoice.paid` row: `→ active` (via re-fetch mirror), dunning cleared.
 * Branch: the §4.2 enable-us one-off invoice (metadata
 * `{ purpose: 'us_registration', company_id }`) stamps
 * `registration_fee_paid_at` and starts the §4.4 R1 submission — the CA
 * owner who paid the $29 fee must enter carrier review with no manual step
 * (SPEC §1 rule 5).
 */
async function handleInvoicePaid(
  env: Env,
  invoice: Stripe.Invoice,
): Promise<void> {
  const db = getDb(env);

  if (
    invoice.metadata?.purpose === "us_registration" &&
    typeof invoice.metadata.company_id === "string"
  ) {
    const { error } = await db
      .from("companies")
      .update({
        registration_fee_paid_at: new Date().toISOString(),
        // The money arrived, so the capability it bought is ON. Re-asserted
        // rather than assumed: a declined FIRST attempt turns the flag back
        // off, and the invoice stays open and payable by a Stripe retry or by
        // the customer. submitRegistration reads the company back, so without
        // this the later success would collect the fee and file nothing.
        us_texting_enabled: true,
      })
      .eq("id", invoice.metadata.company_id)
      .is("registration_fee_paid_at", null);
    if (error) {
      throw new Error(`enable-us fee stamp failed: ${error.message}`);
    }
    // §9: "stamp registration_fee_paid_at and start the §4.4 submission
    // (R1)". Idempotent — the is-null-guarded stamp and submitRegistration's
    // no-op branches make redelivery/sweeper re-runs harmless; a Telnyx
    // failure propagates so the ledger retries the submission.
    await submitRegistration(env, invoice.metadata.company_id);
  }

  const subscriptionId = invoiceSubscriptionId(invoice);
  if (subscriptionId) await syncSubscription(env, subscriptionId, db);
}

/**
 * §9 `invoice.payment_failed` row: `→ past_due` (mirrored from a re-fetch, so
 * out-of-order deliveries land on the truth), outbound blocked by the send
 * gate, owner + admins emailed.
 */
async function handleInvoicePaymentFailed(
  env: Env,
  invoice: Stripe.Invoice,
): Promise<void> {
  const db = getDb(env);

  // §2: the one-time US-registration fee invoice failed to collect. Undo the
  // WHOLE enable-us write so the CA owner can re-attempt — exactly what the
  // route's own synchronous catch block rolls back.
  //
  // Clearing only the start-marker was not enough: the route flips
  // `us_texting_enabled` to true BEFORE invoicing, and once finalizeInvoice
  // succeeds, collection is async — so a declined card lands here with the flag
  // still true. The promised "re-attempt" was then impossible, because
  // enable-us hard-409s on `us_texting_enabled` ("US texting is already
  // enabled.") and /submit 409s too, with no other post-checkout writer of the
  // flag to recover it: the company was wedged with US texting marked on and
  // the $29 never collected.
  //
  // Gated on registration_fee_paid_at IS NULL so a late failure event for a
  // since-paid fee can't wrongly reopen it — all-or-nothing, like the route's
  // rollback. (This invoice carries no subscription, so it must be handled
  // before the subscription-dunning path returns below.)
  if (
    invoice.metadata?.purpose === "us_registration" &&
    typeof invoice.metadata.company_id === "string"
  ) {
    const { error } = await db
      .from("companies")
      .update({
        registration_fee_charge_started_at: null,
        us_texting_enabled: false,
      })
      .eq("id", invoice.metadata.company_id)
      .is("registration_fee_paid_at", null);
    if (error) {
      throw new Error(`enable-us fee marker clear failed: ${error.message}`);
    }

    // Close the failed invoice, or the owner pays twice. Rolling the company
    // back invites them to press enable-us again, and the idempotency key that
    // would have replayed the first invoice expires after about a day, so a
    // second attempt mints a SECOND invoice. Meanwhile this one is still inside
    // Stripe's automatic retry schedule, which runs for roughly two weeks: both
    // can collect $29, and the later one reconciles to nothing because
    // registration_fee_paid_at is already stamped.
    //
    // A refusal and a failure are different things. Stripe refuses to void an
    // invoice whose status no longer allows it, which is the paid path winning
    // the race: a consistent outcome, and nothing to retry. A transport or
    // server error means the invoice is still open and still collectable, so
    // giving up there would quietly restore the double charge. Raising it puts
    // the event back on the ledger, and the sweeper replays this handler; the
    // rollback above is guarded and safe to run again.
    if (invoice.id) {
      try {
        await getStripe(env).invoices.voidInvoice(invoice.id);
      } catch (cause) {
        const status = (cause as { statusCode?: number }).statusCode;
        const refused = typeof status === "number" && status >= 400 && status < 500;
        console.error(
          `us-registration invoice ${invoice.id} could not be voided:`,
          cause instanceof Error ? cause.message : String(cause),
        );
        if (!refused) throw cause;
      }
    }
  }

  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const companies = await syncSubscription(env, subscriptionId, db);
  for (const company of companies) {
    // Out-of-order delivery: syncSubscription just re-fetched the TRUTH. If the
    // subscription is now active (a later payment success landed before this
    // failed-payment event), texting is NOT paused — don't send the alarming
    // "paused" email (and don't burn the per-attempt email-ledger claim on it).
    if (company.status === "active") continue;
    // #52: ONE dunning email per payment ATTEMPT — the key carries
    // `attempt_count`, so each of Stripe's smart retries still notifies the
    // customer (a distinct failure), while sweeper replays of this same event
    // (same invoice, same attempt) never re-send.
    const claimed = await claimEmailOnce(
      db,
      company.id,
      `invoice_payment_failed:${invoice.id}:${invoice.attempt_count ?? 0}`,
    );
    if (!claimed) continue;
    const to = await billingRecipients(env, company.id, db);
    if (to.length === 0) continue;
    const portal = `${env.APP_ORIGIN}/settings/billing`;
    const invoiceLine = invoice.hosted_invoice_url
      ? `You can also pay the open invoice directly: ${invoice.hosted_invoice_url}\n\n`
      : "";
    const text =
      `Hi,\n\nA payment for ${company.name}'s Loonext subscription failed, so ` +
      `outbound texting is paused. Receiving texts and your dashboard keep working.\n\n` +
      `Update your payment method to resume texting: ${portal}\n\n` +
      invoiceLine +
      `Stripe retries the charge automatically over the next two weeks.\n\nLoonext`;
    await sendEmail(env, {
      to,
      subject: "Your Loonext payment failed: outbound texting is paused",
      text,
      // renderEmailHtml escapes — company.name is customer-controlled input.
      html: renderEmailHtml(text),
    });
  }
}

/**
 * §9 `invoice.payment_action_required` row: no state change — email the
 * hosted invoice link so the customer can complete SCA confirmation.
 */
async function handlePaymentActionRequired(
  env: Env,
  invoice: Stripe.Invoice,
): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  // Re-fetch the invoice for the TRUTH: a stored-payload replay or out-of-order
  // delivery carries a stale 'open' status, so only email when it STILL needs
  // action (skip once it's paid/void/uncollectible).
  if (typeof invoice.id === "string") {
    const fresh = await getStripe(env).invoices.retrieve(invoice.id);
    if (fresh.status !== "open") return;
  }

  const db = getDb(env);
  const { data, error } = await db
    .from("companies")
    .select("id,name")
    .eq("stripe_subscription_id", subscriptionId)
    .limit(1);
  if (error) throw new Error(`companies lookup failed: ${error.message}`);
  const company = (data ?? [])[0] as { id: string; name: string } | undefined;
  if (!company) return;

  const to = await billingRecipients(env, company.id, db);
  if (to.length === 0) return;
  const link = invoice.hosted_invoice_url;
  const text =
    `Hi,\n\nYour bank needs you to confirm the latest Loonext payment for ` +
    `${company.name}.\n\n` +
    (link
      ? `Confirm it here: ${link}\n\n`
      : `Open your billing portal to confirm: ${env.APP_ORIGIN}/settings/billing\n\n`) +
    `Texting continues normally once the payment is confirmed.\n\nLoonext`;
  await sendEmail(env, {
    to,
    subject: "Action needed: confirm your Loonext payment",
    text,
    // renderEmailHtml escapes — company.name is customer-controlled input.
    html: renderEmailHtml(text),
  });
}
