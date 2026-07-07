import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";

import { capture } from "../analytics/posthog";
import {
  applyModuleReconcile,
  planModuleReconcile,
  type CompanyModuleRow,
} from "../billing/company-modules";
import { recordAndSendGraceNotice } from "../billing/grace";
import {
  moduleForPrice,
  modulePrice,
  PLAN_MODULES,
  type PlanModule,
} from "../billing/modules";
import {
  hasLiveSubscription,
  mirrorSubscriptionStatus,
  planForLicensedPrice,
  type PlanId,
} from "../billing/plans";
import { billingRecipients } from "../billing/recipients";
import { getStripe, stripeCryptoProvider, type Stripe } from "../billing/stripe";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { sendEmail } from "../email/resend";
import { portDocumentsNeededCopy } from "../telnyx/emails";
import { sendPortEmail, startPortSaga } from "../telnyx/porting";
import {
  provisionCompanyNumber,
  suspendCompanyNumbers,
} from "../telnyx/provisioning";
import { submitRegistration } from "../telnyx/registration";

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
  let event: Stripe.Event;
  try {
    event = await getStripe(env).webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined, // default 300s tolerance
      stripeCryptoProvider,
    );
  } catch {
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
 * §9 `checkout.session.completed` row: `payment_status=='paid'` guard;
 * `incomplete → active`; store customer/subscription/plan/period; stamp
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
  if (session.payment_status !== "paid") return; // §9 guard — ack as no-op

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
  // Re-fetch guard: mirror the subscription's CURRENT truth, not the event's.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const status = mirrorSubscriptionStatus(subscription.status) ?? "active";
  const period = subscriptionPeriod(subscription);
  const plan = subscriptionPlan(env, subscription);

  const db = getDb(env);
  const { data: activated, error } = await db
    .from("companies")
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: status,
      current_period_start: period.start,
      current_period_end: period.end,
      canceled_at: null,
      cancel_at_period_end: subscription.cancel_at_period_end === true,
      ...(plan ? { plan } : {}),
    })
    .eq("id", companyId)
    // company_modules embedded so the #17 module reconcile below needs no
    // second read — the activation write and the module truth arrive together.
    .select("id,company_modules(module,disabled_at,grandfathered)");
  if (error) throw new Error(`companies activate failed: ${error.message}`);
  const moduleRows =
    ((activated ?? [])[0] as
      | { company_modules?: CompanyModuleRow[] }
      | undefined)?.company_modules ?? [];

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
    const { error: unsuspendError } = await db
      .from("phone_numbers")
      .update({ status: "active", suspended_at: null })
      .eq("company_id", companyId)
      .eq("status", "suspended");
    if (unsuspendError) {
      throw new Error(`number un-suspend failed: ${unsuspendError.message}`);
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
): Promise<{ id: string; name: string }[]> {
  const subscription = await getStripe(env).subscriptions.retrieve(
    subscriptionId,
  );
  const status = mirrorSubscriptionStatus(subscription.status);
  if (status === null) return []; // unmappable (paused) — leave state alone

  const period = subscriptionPeriod(subscription);
  const plan = subscriptionPlan(env, subscription);
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
    .select("id,name,canceled_at,company_modules(module,disabled_at,grandfathered)");
  if (error) throw new Error(`subscription mirror failed: ${error.message}`);
  const companies = (data ?? []) as {
    id: string;
    name: string;
    canceled_at: string | null;
    company_modules?: CompanyModuleRow[];
  }[];

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
  return companies.map(({ id, name }) => ({ id, name }));
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
      .update({ registration_fee_paid_at: new Date().toISOString() })
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
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const db = getDb(env);
  const companies = await syncSubscription(env, subscriptionId, db);
  for (const company of companies) {
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
      `Stripe retries the charge automatically over the next two weeks.\n\n— Loonext`;
    await sendEmail(env, {
      to,
      subject: "Your Loonext payment failed — outbound texting is paused",
      text,
      html: `<p>${text.replaceAll("\n\n", "</p><p>").replaceAll("\n", "<br>")}</p>`,
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
    `Texting continues normally once the payment is confirmed.\n\n— Loonext`;
  await sendEmail(env, {
    to,
    subject: "Action needed: confirm your Loonext payment",
    text,
    html: `<p>${text.replaceAll("\n\n", "</p><p>").replaceAll("\n", "<br>")}</p>`,
  });
}
