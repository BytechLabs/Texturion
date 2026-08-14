/**
 * #224 / D133 — Stripe events that happened on somebody ELSE's account.
 *
 * ## Why these are separated from the platform's own events
 *
 * A Connect event carries `event.account`, and everything about how it must be
 * handled follows from that one field. The subscription handlers next door
 * resolve a company from a Stripe CUSTOMER id, which is a platform-side object;
 * these resolve one from a CONNECTED ACCOUNT id, which is a different keyspace
 * belonging to a different Stripe account. Running an event from one through
 * the handlers for the other is the class of mistake that silences a
 * subscription or, worse, credits the wrong workspace.
 *
 * So `processStripeEvent` branches on `event.account` FIRST, before its own
 * switch, and everything below this line only ever sees connected-account
 * events.
 *
 * ## The security control, stated once
 *
 * Connect events are delivered to a shared endpoint. Anyone in the world can
 * create a Stripe account, and a hostile connected account could name another
 * workspace's payment link in an object it controls. Every lookup here is keyed
 * on BOTH the object and `event.account`, and the two RPCs enforce the same
 * pairing in SQL, so an event from the wrong account resolves to nothing rather
 * than to somebody else's money.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadConnectAccountByStripeId, saveConnectMirror } from "../billing/connect";
import { getStripe, type Stripe } from "../billing/stripe";
import { getDb } from "../db";
import type { Env } from "../env";
import { notifyPayment, type PaymentOutcome } from "../notifications/payment";
import { insertConversationEvents } from "../routes/core/events";

/**
 * Every connected-account event we act on.
 *
 * Deliberately a small set. The Connect endpoint can be subscribed to dozens of
 * event types and each one we do not handle is acked as a no-op — the same
 * discipline the platform switch keeps.
 */
export async function processConnectEvent(
  env: Env,
  event: Stripe.Event,
): Promise<void> {
  const account = event.account;
  if (!account) return;

  switch (event.type) {
    case "account.updated":
      return handleAccountUpdated(env, event.data.object as Stripe.Account, account);
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return handleConnectCheckout(
        env,
        event.data.object as Stripe.Checkout.Session,
        account,
      );
    case "charge.refunded":
      return handleChargeRefunded(env, event.data.object as Stripe.Charge, account);
    case "charge.dispute.created":
      return handleConnectDispute(env, event.data.object as Stripe.Dispute, account);
    default:
      return;
  }
}

/**
 * The account's own state changed — verification cleared, a requirement
 * appeared, payouts were paused.
 *
 * The mirror is replaced wholesale rather than patched. Stripe's answer is the
 * whole answer, and merging fields would leave a stale `disabled_reason`
 * sitting beside a fresh `charges_enabled` — which is exactly the combination
 * that would let a workspace send a request its customer cannot pay.
 */
async function handleAccountUpdated(
  env: Env,
  account: Stripe.Account,
  accountId: string,
): Promise<void> {
  const db = getDb(env);
  const row = await loadConnectAccountByStripeId(db, accountId);
  if (!row) {
    // An account we have no record of. Not an error: an account created and
    // then abandoned before our row was written will emit these, and there is
    // nothing to mirror it onto.
    return;
  }
  await saveConnectMirror(db, row.company_id, accountId, account);
}

/**
 * A customer paid.
 *
 * The payment link id is the key, because it is the object WE created and
 * therefore the only one whose ownership we can vouch for. `session.metadata`
 * is a fallback rather than the primary: Stripe copies a payment link's
 * metadata onto the sessions it creates, but metadata is also settable by
 * anyone who can create a session on their own account, so it is used only to
 * find a candidate — the RPC still requires the account to match.
 */
async function handleConnectCheckout(
  env: Env,
  session: Stripe.Checkout.Session,
  accountId: string,
): Promise<void> {
  if (session.payment_status !== "paid") return;

  const linkId =
    typeof session.payment_link === "string"
      ? session.payment_link
      : (session.payment_link?.id ?? null);
  if (!linkId) return;

  const db = getDb(env);
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  // The charge id, which the refund and dispute paths below key on. Read from
  // the payment intent because a Checkout Session does not carry it, and read
  // ON THE CONNECTED ACCOUNT because that is where the charge lives.
  let chargeId: string | null = null;
  if (paymentIntentId) {
    chargeId = await latestChargeFor(env, paymentIntentId, accountId);
  }

  const { data, error } = await db.rpc("api_mark_payment_request_paid", {
    p_payment_link_id: linkId,
    p_account: accountId,
    p_session: session.id,
    p_payment_intent: paymentIntentId,
    p_charge: chargeId,
    p_amount_received: session.amount_total ?? null,
  });
  if (error) throw new Error(`mark payment paid failed: ${error.message}`);

  const result = data as {
    outcome: string;
    payment_request_id?: string;
    company_id?: string;
    conversation_id?: string;
    amount_cents?: number;
    currency?: string;
    description?: string;
    public_link_id?: string | null;
  };
  // `already_paid` and `unknown` both stop here, and both are correct: a
  // redelivery must not write a second timeline row, and an event for a link we
  // did not create is not ours to act on.
  if (result.outcome !== "paid" || !result.company_id || !result.conversation_id) {
    return;
  }

  // The link has done its job. Revoked rather than left to expire so the page
  // stops being openable the moment the money lands — a live payment page for a
  // paid bill is how somebody pays twice.
  if (result.public_link_id) {
    await revokeQuietly(db, result.public_link_id);
  }

  await insertConversationEvents(db, [
    {
      company_id: result.company_id,
      conversation_id: result.conversation_id,
      // No actor. Nobody in the workspace did this — the customer did, and
      // stamping a crew member would put a name against somebody else's action.
      actor_user_id: null,
      type: "payment_paid",
      payload: {
        payment_request_id: result.payment_request_id,
        amount_cents: result.amount_cents,
        currency: result.currency,
        description: result.description,
      },
    },
  ]);

  await alertTheCrew(env, db, result, "paid", result.amount_cents ?? null);
}

/** The business refunded the customer from their own Stripe dashboard. */
async function handleChargeRefunded(
  env: Env,
  charge: Stripe.Charge,
  accountId: string,
): Promise<void> {
  await settle(env, {
    chargeId: charge.id,
    accountId,
    kind: "refunded",
    amount: charge.amount_refunded ?? null,
    eventType: "payment_refunded",
  });
}

/** The customer's bank pulled the money back. */
async function handleConnectDispute(
  env: Env,
  dispute: Stripe.Dispute,
  accountId: string,
): Promise<void> {
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;
  await settle(env, {
    chargeId,
    accountId,
    kind: "disputed",
    amount: null,
    eventType: "payment_disputed",
  });
}

/**
 * Both post-payment outcomes, which differ only in a word.
 *
 * They land in the THREAD, not only in Stripe, and that is the point of
 * handling them at all: a refund discussed in a Stripe dashboard and invisible
 * where the job lives is how two people end up telling a customer different
 * things about the same money.
 */
async function settle(
  env: Env,
  args: {
    chargeId: string;
    accountId: string;
    kind: "refunded" | "disputed";
    amount: number | null;
    eventType: "payment_refunded" | "payment_disputed";
  },
): Promise<void> {
  const db = getDb(env);
  const { data, error } = await db.rpc("api_mark_payment_request_settled", {
    p_charge: args.chargeId,
    p_account: args.accountId,
    p_kind: args.kind,
    p_amount: args.amount,
  });
  if (error) throw new Error(`mark payment ${args.kind} failed: ${error.message}`);

  const result = data as {
    outcome: string;
    payment_request_id?: string;
    company_id?: string;
    conversation_id?: string;
    amount_cents?: number;
    amount_refunded_cents?: number | null;
    currency?: string;
    description?: string;
  };
  if (result.outcome !== args.kind || !result.company_id || !result.conversation_id) {
    return;
  }

  await insertConversationEvents(db, [
    {
      company_id: result.company_id,
      conversation_id: result.conversation_id,
      actor_user_id: null,
      type: args.eventType,
      payload: {
        payment_request_id: result.payment_request_id,
        amount_cents: result.amount_cents,
        amount_refunded_cents: result.amount_refunded_cents ?? null,
        currency: result.currency,
        description: result.description,
      },
    },
  ]);

  // The figure the THREAD will show for this event, so the lock screen and the
  // timeline never quote two different numbers about one payment: a refund
  // narrates what went back, everything else what was asked.
  await alertTheCrew(
    env,
    db,
    result,
    args.kind,
    (args.kind === "refunded"
      ? (result.amount_refunded_cents ?? result.amount_cents)
      : result.amount_cents) ?? null,
  );
}

/**
 * #607 option B — and the phones, for whoever is not looking at a screen.
 *
 * BEST-EFFORT BY CONTRACT, unlike every other caller of a notify* function.
 * Throwing here would fail the webhook, and a Stripe redelivery resolves
 * `already_paid` / `noop` and returns before this line — so the retry would not
 * re-send the alert, it would only re-fail the delivery. The money is recorded,
 * the thread already updated live (option A), and a lost push is worth less
 * than a Connect endpoint that reports failure for something it cannot fix.
 */
async function alertTheCrew(
  env: Env,
  db: SupabaseClient,
  result: {
    payment_request_id?: string;
    company_id?: string;
    conversation_id?: string;
    currency?: string;
    description?: string;
  },
  outcome: PaymentOutcome,
  amountCents: number | null,
): Promise<void> {
  const { payment_request_id, company_id, conversation_id } = result;
  if (!payment_request_id || !company_id || !conversation_id) return;
  try {
    await notifyPayment(
      env,
      {
        companyId: company_id,
        conversationId: conversation_id,
        paymentRequestId: payment_request_id,
        outcome,
        amountCents,
        currency: result.currency ?? null,
        description: result.description ?? null,
      },
      db,
    );
  } catch (cause) {
    console.error(`payment alert failed for ${payment_request_id}: ${String(cause)}`);
  }
}

/** The charge behind a payment intent, on the connected account. */
async function latestChargeFor(
  env: Env,
  paymentIntentId: string,
  accountId: string,
): Promise<string | null> {
  try {
    const intent = await getStripe(env).paymentIntents.retrieve(
      paymentIntentId,
      undefined,
      { stripeAccount: accountId },
    );
    const latest = (intent as Stripe.PaymentIntent & { latest_charge?: string | Stripe.Charge })
      .latest_charge;
    if (!latest) return null;
    return typeof latest === "string" ? latest : latest.id;
  } catch (cause) {
    // Not fatal. Without the charge id a later refund cannot be matched, which
    // costs a timeline row — not the payment, which is already recorded.
    console.warn(`payment intent retrieve failed: ${String(cause)}`);
    return null;
  }
}

async function revokeQuietly(db: SupabaseClient, linkId: string): Promise<void> {
  const { error } = await db.rpc("api_revoke_public_link", {
    p_link_id: linkId,
    p_reason: "paid",
  });
  if (error) console.warn(`revoke paid link failed: ${error.message}`);
}
