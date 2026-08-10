/**
 * #224 / D133 — text-to-pay.
 *
 * Mounted in three places, because it is three different trust surfaces:
 *
 *   /v1/payments/*                the OWNER's setup (workspace.own)
 *   /v1/conversations/:id/payment-requests   the CREW's ask (conversations.send)
 *   /pay/:token                   the CUSTOMER's page (no account at all)
 *
 * ## Why the crew can ask and only the owner can set up
 *
 * Connecting the account binds a legal entity and a bank account to the
 * workspace — capabilities.ts says anything that spends money or moves the
 * number is owner-only, and this is squarely that class. Sending a request is
 * `conversations.send`, the same capability as any other outbound message,
 * because that is exactly what it is: the tech standing in the customer's
 * driveway is the person who needs to ask for the deposit, and a feature only
 * the owner can use is a feature that gets replaced by a personal e-transfer.
 *
 * ## The gate order, and why the money step is last
 *
 * runPreSendGates → charges_enabled → mint → insert → gateOutboundSend →
 * dispatch. Every refusal that can be known without touching Stripe happens
 * before we create anything at Stripe, so an opted-out contact or a suspended
 * workspace never leaves an orphan payment link behind. The one step that can
 * still fail after minting — the rate/cap gate, which is atomic with the
 * message insert — cleans up after itself rather than leaving a live link for a
 * message that never went.
 */
import {
  estimateSegments,
  formatMoney,
  isBillingCurrency,
  PAYMENT_DESCRIPTION_MAX,
  paymentAmountProblem,
  paymentAmountProblemCopy,
  paymentRequestSms,
  paymentRequestState,
  payoutReadinessCopy,
  roleHasCapability,
  type BillingCurrency,
  type MemberRole,
} from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireAnyCapability, requireCapability } from "../auth/company";
import { assertNumberLevel } from "../auth/number-access";
import {
  assertCanCharge,
  createConnectAccount,
  createDashboardLink,
  createOnboardingLink,
  connectCountryFor,
  loadConnectAccount,
  readinessOf,
  refreshConnectAccount,
  type ConnectAccountRow,
} from "../billing/connect";
import { getStripe } from "../billing/stripe";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import {
  dispatchOutbound,
  gateOutboundSend,
  runPreSendGates,
} from "../messaging/send";
import {
  callerCountry,
  publicLinkGuard,
  publicLinkNotAvailable,
} from "../public-links/guard";
import {
  mintPublicLink,
  resolvePublicLink,
  revokePublicLink,
} from "../public-links/tokens";
import { insertConversationEvents } from "./core/events";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";
import { requireIdempotencyKey } from "./messages";

type Db = ReturnType<typeof getDb>;

/** Which width of the account object this caller has earned. */
function scopeFor(role: MemberRole | undefined): "operator" | "sender" {
  return role !== undefined && roleHasCapability(role, "billing.manage")
    ? "operator"
    : "sender";
}

/** Authenticated, owner-only: connect and inspect the Stripe account. */
export const paymentAccountRoutes = new Hono<AppEnv>();
/** Authenticated, crew: ask a customer for money, and call it off. */
export const paymentRequestRoutes = new Hono<AppEnv>();
/** Unauthenticated: the page the customer opens. Mounted at the ROOT. */
export const publicPaymentRoutes = new Hono<AppEnv>();

/**
 * How long a payment request stays payable — fourteen days.
 *
 * D75 requires an expiry and leaves the number to the feature. Fourteen days is
 * longer than any deposit conversation and shorter than the point where a
 * homeowner has forgotten what the money was for: paying a bill you no longer
 * recognise is how a legitimate charge becomes a chargeback, which lands on the
 * business, not on us. A crew that needs longer sends another.
 */
const PAYMENT_LINK_DAYS = 14;

/** The row shape every response is built from. */
const REQUEST_COLUMNS =
  "id,conversation_id,contact_id,message_id,amount_cents,currency,description," +
  "status,paid_at,refunded_at,amount_refunded_cents,disputed_at,cancelled_at," +
  "expires_at,created_at,created_by";

interface PaymentRequestRow {
  id: string;
  conversation_id: string;
  contact_id: string;
  message_id: string | null;
  amount_cents: number;
  currency: BillingCurrency;
  description: string;
  status: "requested" | "paid" | "cancelled" | "expired";
  paid_at: string | null;
  refunded_at: string | null;
  amount_refunded_cents: number | null;
  disputed_at: string | null;
  cancelled_at: string | null;
  expires_at: string;
  created_at: string;
  created_by: string | null;
}

/**
 * The wire object.
 *
 * `state` is computed here as well as on every client. That is not duplication
 * for its own sake: the clients need it to render offline rows from their own
 * cache, and the API needs it so a consumer that never reads our shared package
 * still gets the right word. Both call the same function.
 */
function requestJson(row: PaymentRequestRow): Record<string, unknown> {
  return { ...row, state: paymentRequestState(row) };
}

/**
 * The account object, in one of two widths.
 *
 * TWO READERS, and they need different things. The owner or bookkeeper on the
 * settings screen needs everything, including what Stripe is still waiting for.
 * The tech in a driveway needs exactly two facts — can this workspace take a
 * card, and in what currency — because that is what decides whether an "Ask for
 * payment" control appears at all.
 *
 * The narrow answer is not a courtesy, it is the point. `requirements_due` is a
 * list of what the OWNER personally still owes Stripe ("Photo ID for the
 * business owner", "The owner's SIN or SSN"), and `disabled_reason` is a
 * statement about the business's standing with a payment processor. A tech
 * needs neither to send a bill, so neither is sent.
 *
 * `readiness` and the copy stay in both, because a workspace that cannot charge
 * has to be able to say so honestly on every surface — silently rendering
 * nothing is how somebody concludes the feature is broken.
 */
function accountJson(
  row: ConnectAccountRow | null,
  scope: "operator" | "sender",
): Record<string, unknown> {
  const readiness = readinessOf(row);
  const copy = payoutReadinessCopy(readiness);
  const shared = {
    connected: row !== null,
    readiness,
    title: copy.title,
    detail: copy.detail,
    currency: row?.default_currency ?? null,
    charges_enabled: row?.charges_enabled ?? false,
  };
  if (scope === "sender") {
    // No `action` either: every action on this object leads to a screen the
    // sender cannot open, and offering one would be a dead end.
    return { ...shared, action: null };
  }
  return {
    ...shared,
    action: copy.action,
    country: row?.country ?? null,
    payouts_enabled: row?.payouts_enabled ?? false,
    details_submitted: row?.details_submitted ?? false,
    disabled_reason: row?.disabled_reason ?? null,
    requirements_due: row?.requirements_due ?? [],
    requirements_deadline: row?.requirements_deadline ?? null,
  };
}

/**
 * GET /v1/payments/account — what Stripe says right now.
 *
 * Refreshes from Stripe on every read rather than trusting the mirror, and
 * degrades to the mirror when Stripe is unreachable. The read happens when
 * somebody opens a settings page, so the cost is one API call on a rare screen;
 * the alternative is a business that finished onboarding sixty seconds ago
 * being told they have not.
 */
paymentAccountRoutes.get(
  "/payments/account",
  /**
   * #224: EITHER capability, and the response narrows for the second.
   *
   * `billing.manage` alone would have made the feature unreachable for the
   * person it was written for. A plain member holds `conversations.send` and
   * not `billing.manage`, so the composer could never learn whether payments
   * were switched on, so the "Ask for payment" control could never appear — for
   * the tech in the driveway, on every thread, permanently. The route the
   * clients call to decide whether to offer a control cannot be gated more
   * tightly than the action itself.
   */
  requireAnyCapability("billing.manage", "conversations.send"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");
    let row = await loadConnectAccount(db, companyId);
    if (row) {
      try {
        row = await refreshConnectAccount(env, db, row);
      } catch (cause) {
        // The mirror is what we have. Saying "we cannot reach Stripe" on a
        // settings page nobody can act on from is worse than showing the last
        // known answer, which is right almost always.
        console.warn(`connect refresh failed: ${String(cause)}`);
      }
    }
    return c.json(accountJson(row, scopeFor(c.get("role"))));
  },
);

/**
 * POST /v1/payments/account/onboarding — start or resume setting up.
 *
 * One route for both, because from the owner's side they are one action: the
 * account is created if it does not exist, and either way they get a link into
 * Stripe's flow at whatever point they left it.
 */
paymentAccountRoutes.post(
  "/payments/account/onboarding",
  // Owner only. This binds a legal entity and a bank account to the workspace,
  // which is the class capabilities.ts keeps with `workspace.own` — not because
  // an admin is untrusted, but because it is not theirs to answer for.
  requireCapability("workspace.own"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");

    let row = await loadConnectAccount(db, companyId);
    if (!row) {
      const company = unwrap<{ country: string; name: string }[]>(
        await db.from("companies").select("country,name").eq("id", companyId).limit(1),
        "company lookup",
      )[0];
      if (!company) throw new ApiError("not_found", "No such workspace.");

      const email = unwrap<{ email: string | null }[]>(
        await db.from("profiles").select("email").eq("id", c.get("userId")).limit(1),
        "profile lookup",
      )[0];

      row = await createConnectAccount(env, db, {
        companyId,
        country: connectCountryFor(company.country),
        email: email?.email ?? null,
        userId: c.get("userId"),
      });

      await recordAuditFromRequest(db, c, {
        companyId,
        action: "payments.account_connected",
        targetType: "company",
        targetId: companyId,
        after: { stripe_account_id: row.stripe_account_id, country: row.country },
      });
    }

    const url = await createOnboardingLink(env, row.stripe_account_id, env.APP_ORIGIN);
    // Always the operator width: this route is owner-only.
    return c.json({ url, account: accountJson(row, "operator") });
  },
);

/**
 * GET /v1/payments/account/dashboard — a login link to their own Stripe.
 *
 * THE REFUND AND DISPUTE PATH. `billing.manage` rather than `workspace.own`
 * because refunding a customer is bookkeeping, and the bookkeeper role exists
 * precisely so the person who does the books does not need the owner's login.
 */
paymentAccountRoutes.get(
  "/payments/account/dashboard",
  requireCapability("billing.manage"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const row = await loadConnectAccount(db, c.get("companyId"));
    if (!row) {
      return errorResponse(
        c,
        "conflict",
        "This workspace has not set up payments yet.",
      );
    }
    const url = await createDashboardLink(env, row.stripe_account_id);
    return c.json({ url });
  },
);

const createSchema = z.object({
  /**
   * Cents, integer, and named so. A `amount` in dollars as a float is how a
   * payment feature ships a rounding bug that only appears on some amounts.
   */
  amount_cents: z.number().int(),
  description: z.string().min(1).max(PAYMENT_DESCRIPTION_MAX),
});

/**
 * POST /v1/conversations/:id/payment-requests — ask, and send.
 */
paymentRequestRoutes.post(
  "/conversations/:id/payment-requests",
  requireCapability("conversations.send"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");
    const conversationId = pathUuid(c, "id");
    const idempotencyKey = requireIdempotencyKey(c);
    const body = await parseJsonBody(c, createSchema);

    const view = await loadPaymentView(db, companyId, conversationId);
    // #106: this sends a text, so it needs the same 'text' level on the
    // conversation's number that any other send does.
    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: view.phone_number_id ?? null,
      need: "text",
    });
    const fromNumber = view.phone_numbers.number_e164;
    if (!fromNumber || view.phone_numbers.status !== "active") {
      throw new ApiError(
        "conflict",
        "This conversation's number can't send texts right now.",
      );
    }

    // Gate order, and the reason it is this way round: EVERY refusal that can
    // be decided without Stripe is decided before anything exists at Stripe.
    // An opted-out contact, a suspended workspace or an unregistered
    // destination must never leave a live payment link behind.
    const clearance = await runPreSendGates(env, companyId, view.contact_phone_e164);

    let account = await loadConnectAccount(db, companyId);
    if (account) {
      try {
        account = await refreshConnectAccount(env, db, account);
      } catch (cause) {
        console.warn(`connect refresh failed: ${String(cause)}`);
      }
    }
    assertCanCharge(readinessOf(account));
    // Narrowing for tsc: assertCanCharge throws on every readiness except
    // "ready", which is unreachable without a row.
    if (!account) throw new ApiError("conflict", "Payments are not set up.");

    const currency = accountCurrency(account);
    const problem = paymentAmountProblem(body.amount_cents);
    if (problem) {
      throw new ApiError(
        "validation_failed",
        paymentAmountProblemCopy(problem, currency),
      );
    }

    const description = body.description.trim();
    const expiresAt = new Date(Date.now() + PAYMENT_LINK_DAYS * 24 * 60 * 60 * 1000);

    // The row first, so the link and the token have something to point at and
    // so a crash between the two leaves a request nobody can pay rather than a
    // payable link nobody can see.
    const request = unwrap<PaymentRequestRow[]>(
      await db
        .from("payment_requests")
        .insert({
          company_id: companyId,
          conversation_id: view.id,
          contact_id: view.contact_id,
          amount_cents: body.amount_cents,
          currency,
          description,
          stripe_account_id: account.stripe_account_id,
          expires_at: expiresAt.toISOString(),
          created_by: c.get("userId"),
        })
        .select(REQUEST_COLUMNS),
      "payment request insert",
    )[0];
    if (!request) throw new Error("payment request insert returned no row");

    const link = await mintPublicLink(db, {
      companyId,
      purpose: "payment",
      subjectType: "payment_request",
      subjectId: request.id,
      expiresAt,
      // Deliberately NOT single-use. A homeowner opens the text, gets
      // interrupted, and comes back — and a link that died on the first tap
      // would tell them the business had cancelled on them. The link dies when
      // the request is PAID, which is the event that actually spends it.
      actorUserId: c.get("userId"),
    });

    // Only now does anything exist at Stripe.
    const paymentLink = await createStripePaymentLink(env, {
      account: account.stripe_account_id,
      amountCents: body.amount_cents,
      currency,
      description,
      businessName: view.companies.name,
      requestId: request.id,
      companyId,
    });

    await db
      .from("payment_requests")
      .update({
        stripe_payment_link_id: paymentLink.id,
        public_link_id: link.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .eq("company_id", companyId);

    const url = `${env.APP_ORIGIN.replace(/\/$/, "")}/pay/${link.token}`;
    const text = paymentRequestSms({
      businessName: view.companies.name,
      amountCents: body.amount_cents,
      currency,
      description,
      url,
    });

    let message;
    try {
      const gated = await gateOutboundSend(db, {
        companyId,
        conversationId: view.id,
        senderUserId: c.get("userId"),
        body: text,
        idempotencyKey,
        // The same estimator every other send bills against — the URL makes a
        // request reliably multi-segment and it is metered as what it is.
        segmentsEstimate: estimateSegments(text).segments,
      });
      if (gated.existing) {
        // A duplicate request. The row we just created is a second ask nobody
        // made, so it goes, and the caller gets the original.
        await cancelQuietly(env, db, companyId, request.id, paymentLink.id, link.id);
        const original = await loadRequestForMessage(db, companyId, gated.message.id);
        return c.json(original ? requestJson(original) : requestJson(request), 200);
      }
      message = gated.message;
    } catch (cause) {
      // The rate/cap gate refused, or the insert failed. Either way there is a
      // live payment link for a text that will never arrive — kill it rather
      // than leave a customer able to pay a request nobody sent.
      await cancelQuietly(env, db, companyId, request.id, paymentLink.id, link.id);
      throw cause;
    }

    await db
      .from("payment_requests")
      .update({ message_id: message.id, updated_at: new Date().toISOString() })
      .eq("id", request.id)
      .eq("company_id", companyId);

    try {
      await dispatchOutbound(env, db, message, {
        from: fromNumber,
        to: view.contact_phone_e164,
        text,
        mediaUrls: [],
        clearance,
      });
    } catch (cause) {
      await cancelQuietly(env, db, companyId, request.id, paymentLink.id, link.id);
      throw cause;
    }

    await insertConversationEvents(db, [
      {
        company_id: companyId,
        conversation_id: view.id,
        actor_user_id: c.get("userId"),
        type: "payment_requested",
        payload: {
          payment_request_id: request.id,
          amount_cents: body.amount_cents,
          currency,
          description,
        },
      },
    ]);

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "payments.request_sent",
      targetType: "payment_request",
      targetId: request.id,
      after: {
        amount_cents: body.amount_cents,
        currency,
        description,
        conversation_id: view.id,
      },
    });

    const saved = await loadRequest(db, companyId, request.id);
    return c.json(requestJson(saved ?? request), 201);
  },
);

/** GET /v1/conversations/:id/payment-requests — the thread's money, newest first. */
paymentRequestRoutes.get(
  "/conversations/:id/payment-requests",
  requireCapability("conversations.read"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");
    const conversationId = pathUuid(c, "id");
    const view = await loadPaymentView(db, companyId, conversationId);
    await assertNumberLevel(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      phoneNumberId: view.phone_number_id ?? null,
      need: "note",
    });

    const rows = unwrap<PaymentRequestRow[]>(
      await db
        .from("payment_requests")
        .select(REQUEST_COLUMNS)
        .eq("company_id", companyId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(50),
      "payment request list",
    );
    return c.json({ payment_requests: rows.map(requestJson) });
  },
);

/**
 * POST /v1/payment-requests/:id/cancel — call it off.
 *
 * The link dies, the Stripe link is deactivated, and the thread says so. Not a
 * DELETE: the request happened, the customer received a text about it, and
 * erasing the record would leave the crew unable to explain a text the customer
 * still has on their phone.
 */
paymentRequestRoutes.post(
  "/payment-requests/:id/cancel",
  requireCapability("conversations.send"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const companyId = c.get("companyId");
    const requestId = pathUuid(c, "id");

    const row = unwrap<
      (PaymentRequestRow & {
        stripe_payment_link_id: string | null;
        stripe_account_id: string;
        public_link_id: string | null;
      })[]
    >(
      await db
        .from("payment_requests")
        .select(
          `${REQUEST_COLUMNS},stripe_payment_link_id,stripe_account_id,public_link_id`,
        )
        .eq("company_id", companyId)
        .eq("id", requestId)
        .limit(1),
      "payment request lookup",
    )[0];
    if (!row) return errorResponse(c, "not_found", "No such payment request.");

    const state = paymentRequestState(row);
    if (state === "paid" || state === "refunded" || state === "disputed") {
      return errorResponse(
        c,
        "conflict",
        "This one is already paid. Refund it from your Stripe dashboard instead.",
      );
    }
    if (state !== "requested") {
      // Already cancelled or expired — idempotent, and the honest answer is the
      // row as it stands rather than an error about a state that is fine.
      return c.json(requestJson(row), 200);
    }

    await deactivateStripeLink(env, row.stripe_account_id, row.stripe_payment_link_id);
    if (row.public_link_id) {
      await revokePublicLink(db, row.public_link_id, "the crew cancelled the request");
    }

    const updated = unwrap<PaymentRequestRow[]>(
      await db
        .from("payment_requests")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_by: c.get("userId"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)
        .eq("company_id", companyId)
        .eq("status", "requested")
        .select(REQUEST_COLUMNS),
      "payment request cancel",
    )[0];

    await insertConversationEvents(db, [
      {
        company_id: companyId,
        conversation_id: row.conversation_id,
        actor_user_id: c.get("userId"),
        type: "payment_cancelled",
        payload: {
          payment_request_id: row.id,
          amount_cents: row.amount_cents,
          currency: row.currency,
        },
      },
    ]);

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "payments.request_cancelled",
      targetType: "payment_request",
      targetId: row.id,
      before: { status: row.status },
      after: { status: "cancelled" },
    });

    return c.json(requestJson(updated ?? row));
  },
);

/**
 * GET /pay/:token — the page a homeowner opens.
 *
 * Outside /v1 and therefore outside every gate that protects it, which is why
 * the D75 guard is mounted here rather than assumed. What it may show is
 * decided by the same rule as #294's photo page: the business's name, the
 * amount, and what the money is for. NOT the customer's name, address or
 * number — they already know those, and this is a URL that lives in SMS logs
 * and browser history.
 */
publicPaymentRoutes.get("/pay/:token", publicLinkGuard(), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const resolved = await resolvePublicLink(
    db,
    c.req.param("token"),
    "payment",
    callerCountry(c),
  );
  if (!resolved.ok || !resolved.subject_id || !resolved.company_id) {
    return publicLinkNotAvailable(c);
  }

  const row = unwrap<
    (PaymentRequestRow & {
      stripe_payment_link_id: string | null;
      stripe_account_id: string;
    })[]
  >(
    await db
      .from("payment_requests")
      .select(`${REQUEST_COLUMNS},stripe_payment_link_id,stripe_account_id`)
      .eq("company_id", resolved.company_id)
      .eq("id", resolved.subject_id)
      .limit(1),
    "public payment lookup",
  )[0];
  if (!row) return publicLinkNotAvailable(c);

  const company = unwrap<{ name: string }[]>(
    await db.from("companies").select("name").eq("id", resolved.company_id).limit(1),
    "company lookup",
  )[0];

  const state = paymentRequestState(row);
  // The pay URL is withheld unless the request is actually payable. A page that
  // renders "Paid" beside a live card form is how somebody pays twice.
  const payUrl =
    state === "requested" && row.stripe_payment_link_id
      ? await stripeLinkUrl(env, row.stripe_account_id, row.stripe_payment_link_id)
      : null;

  return c.json({
    business_name: company?.name ?? "",
    amount_cents: row.amount_cents,
    currency: row.currency,
    amount: formatMoney(row.amount_cents, row.currency),
    description: row.description,
    state,
    expires_at: row.expires_at,
    pay_url: payUrl,
  });
});

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

interface PaymentSendView {
  id: string;
  contact_id: string;
  phone_number_id: string;
  contact_phone_e164: string;
  phone_numbers: { number_e164: string | null; status: string };
  companies: { name: string };
}

async function loadPaymentView(
  db: Db,
  companyId: string,
  conversationId: string,
): Promise<PaymentSendView> {
  const rows = unwrap<PaymentSendView[]>(
    await db
      .from("conversations")
      .select(
        "id,contact_id,phone_number_id,contact_phone_e164," +
          "phone_numbers(number_e164,status),companies(name)",
      )
      .eq("company_id", companyId)
      .eq("id", conversationId)
      .limit(1),
    "conversation lookup",
  );
  const view = rows[0];
  if (!view) throw new ApiError("not_found", "No such conversation.");
  return view;
}

/**
 * The currency a connected account can settle in.
 *
 * Stripe's `default_currency` for the account, falling back to the country —
 * not to a platform default. A Canadian account charging USD would settle at
 * Stripe's conversion rate and the business would receive less than the number
 * they typed, which is the one surprise a payments feature cannot have.
 */
function accountCurrency(account: ConnectAccountRow): BillingCurrency {
  const declared = account.default_currency?.toLowerCase();
  if (declared && isBillingCurrency(declared)) return declared;
  return account.country.toUpperCase() === "CA" ? "cad" : "usd";
}

/**
 * The Stripe object the customer's card meets.
 *
 * A PAYMENT LINK rather than a Checkout Session, for one reason that decides
 * it: a Checkout Session expires within 24 hours and cannot be re-opened, so a
 * homeowner who taps the text on Thursday would find a dead page. The link
 * lives as long as our own D75 token does and we control both ends of that.
 *
 * `stripeAccount` is what makes this a DIRECT charge — the whole liability
 * decision, expressed as one request option. No `application_fee_amount` and no
 * `transfer_data`: their money never routes through us.
 */
async function createStripePaymentLink(
  env: Env,
  args: {
    account: string;
    amountCents: number;
    currency: BillingCurrency;
    description: string;
    businessName: string;
    requestId: string;
    companyId: string;
  },
): Promise<{ id: string; url: string }> {
  const stripe = getStripe(env);
  const link = await stripe.paymentLinks.create(
    {
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: args.currency,
            unit_amount: args.amountCents,
            product_data: { name: args.description },
          },
        },
      ],
      // Carried through to the Checkout Session, so a webhook that arrives
      // without a payment link id still knows what it is about.
      metadata: { payment_request_id: args.requestId, company_id: args.companyId },
      payment_intent_data: {
        metadata: { payment_request_id: args.requestId, company_id: args.companyId },
      },
      // One payment per link. Stripe stops accepting after the first completed
      // session, which is the behaviour a bill needs and a shop front does not.
      restrictions: { completed_sessions: { limit: 1 } },
      after_completion: {
        type: "hosted_confirmation",
        hosted_confirmation: {
          custom_message:
            `Thanks — ${args.businessName} has been paid. ` +
            "Your receipt is on its way by email.",
        },
      },
    },
    { stripeAccount: args.account, idempotencyKey: `payment-link:${args.requestId}` },
  );
  return { id: link.id, url: link.url };
}

/** The hosted URL for a link, read fresh so a deactivated link cannot be paid. */
async function stripeLinkUrl(
  env: Env,
  account: string,
  linkId: string,
): Promise<string | null> {
  try {
    const link = await getStripe(env).paymentLinks.retrieve(
      linkId,
      undefined,
      { stripeAccount: account },
    );
    return link.active ? link.url : null;
  } catch (cause) {
    console.warn(`payment link retrieve failed: ${String(cause)}`);
    return null;
  }
}

/** Stop a link accepting money. Best effort — the row is the record. */
async function deactivateStripeLink(
  env: Env,
  account: string,
  linkId: string | null,
): Promise<void> {
  if (!linkId) return;
  try {
    await getStripe(env).paymentLinks.update(
      linkId,
      { active: false },
      { stripeAccount: account },
    );
  } catch (cause) {
    console.warn(`payment link deactivate failed: ${String(cause)}`);
  }
}

/**
 * Undo a half-built request.
 *
 * Called when the send failed after the link existed. Deliberately swallows its
 * own failures: the caller is already throwing the reason the send did not
 * happen, and replacing that with "cleanup failed" would hide it.
 */
async function cancelQuietly(
  env: Env,
  db: Db,
  companyId: string,
  requestId: string,
  stripeLinkId: string | null,
  publicLinkId: string | null,
): Promise<void> {
  try {
    const account = unwrap<{ stripe_account_id: string }[]>(
      await db
        .from("payment_requests")
        .select("stripe_account_id")
        .eq("id", requestId)
        .eq("company_id", companyId)
        .limit(1),
      "payment request account lookup",
    )[0];
    if (account) {
      await deactivateStripeLink(env, account.stripe_account_id, stripeLinkId);
    }
    if (publicLinkId) {
      await revokePublicLink(db, publicLinkId, "the text never went out");
    }
    await db
      .from("payment_requests")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("company_id", companyId)
      .eq("status", "requested");
  } catch (cause) {
    console.error(`payment request cleanup failed: ${String(cause)}`);
  }
}

async function loadRequest(
  db: Db,
  companyId: string,
  id: string,
): Promise<PaymentRequestRow | null> {
  const rows = unwrap<PaymentRequestRow[]>(
    await db
      .from("payment_requests")
      .select(REQUEST_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "payment request lookup",
  );
  return rows[0] ?? null;
}

async function loadRequestForMessage(
  db: Db,
  companyId: string,
  messageId: string,
): Promise<PaymentRequestRow | null> {
  const rows = unwrap<PaymentRequestRow[]>(
    await db
      .from("payment_requests")
      .select(REQUEST_COLUMNS)
      .eq("company_id", companyId)
      .eq("message_id", messageId)
      .limit(1),
    "payment request lookup",
  );
  return rows[0] ?? null;
}
