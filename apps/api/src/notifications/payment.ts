/**
 * #607 option B — the phone buzzes when the money moves.
 *
 * Option A made an OPEN thread update the moment a card clears. This is the
 * half for the phone in a pocket, which is the scenario the issue actually
 * opens with: somebody standing in a driveway deciding whether to start work.
 * A live update reaches a screen somebody is already looking at; a crew on a
 * job site is not looking at one.
 *
 * ## Who is told
 *
 * Exactly the set the broadcast reached — everyone whose number access covers
 * this thread (#106), via the same `listConversationViewers` every other
 * background sender uses. The broadcast publishes to the per-number topic and
 * this publishes to the people on that number, so a member cannot be buzzed
 * about money on a line they are denied. A `bookkeeper` (#315) falls out of
 * that set because the capability check does not carry `conversations.read`,
 * which is right even though they are the likeliest person to care: the alert
 * names a customer and deep-links into a thread they cannot open.
 *
 * NOT the assignee alone, unlike an inbound text. Narrowing an ordinary message
 * to one person is what stops a crew of ten all answering the same customer;
 * money landing is not a message anybody has to answer, and the person waiting
 * on it is at least as often the owner who sent the ask as the tech who is
 * assigned the thread.
 *
 * ## Volume control
 *
 * `operational`, not a category of its own. Two reasons, and the second is the
 * one that decided it: a payment is about the business's MONEY rather than its
 * inbox, which is the stated line for `operational`; and the batch digest — the
 * only thing a non-operational category can degrade to — renders every held row
 * as "N new messages" (`digestLine`), so a batched payment would have been
 * reported to the crew as a text nobody sent.
 *
 * Quiet hours STILL apply, because `deliverPush` applies them to everything
 * that is not an explicit page. A deposit at 1am is not worth waking somebody
 * for; it is on the timeline and it will be there in the morning.
 *
 * ## Priority
 *
 * Normal. HIGH is a rationed resource with a closed, SQL-enforced set of
 * reasons (#452), and the case for spending it here is weak: the person waiting
 * on a deposit is holding their phone, and a phone in use is not in Doze.
 */
import { formatMoney, isBillingCurrency } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";

import { conversationContactName } from "./contact-name";
import { deliverPush } from "./deliver";

/**
 * The three things that happen to money after an ask is sent.
 *
 * The same three the option-A trigger broadcasts, deliberately: a crew reading
 * a live "Paid" on the laptop and getting nothing on the phone (or the reverse)
 * would be two products disagreeing about one event.
 */
export type PaymentOutcome = "paid" | "refunded" | "disputed";

export interface PaymentNotification {
  companyId: string;
  conversationId: string;
  /** The ask this is about. One alert per outcome per request. */
  paymentRequestId: string;
  outcome: PaymentOutcome;
  /**
   * What changed hands, in the connected account's currency. Null when the
   * event did not carry it — every sentence below has a version that reads
   * correctly without a figure, because a payment alert with no number in it is
   * still worth sending.
   */
  amountCents: number | null;
  /** `usd` / `cad` as stored on the request; anything else is treated as absent. */
  currency: string | null;
  /** What the money was for, as a member typed it (#430: their words). */
  description: string | null;
}

/** The alert, as the clients will see it. Pure, so the wording is assertable. */
export interface PaymentAlert {
  title: string;
  body: string;
  url: string;
  /**
   * What the body degrades to when the workspace has content off (#430). The
   * description is a member's own words and per the personal-data inventory
   * routinely carries an address ("Deposit — 42 Elm, gate code 4417").
   */
  withheldBody: string;
  /**
   * Per request AND per outcome. Keying on the request alone would let a refund
   * erase the "paid" alert it followed, and those are two different facts a
   * crew needs — a payment that arrived and then went back is a conversation,
   * not a correction.
   */
  collapseKey: string;
}

/**
 * The structural discriminator the phones route on.
 *
 * ONE kind for all three outcomes, not three. The phones' job is to decide
 * WHERE a push lands, and all three belong in the same place: a crew that wants
 * to hear about money wants to hear about all of it, and a refund routed
 * somewhere a deposit is not would be a channel somebody could silence and
 * never know they had.
 */
export const PAYMENT_PUSH_KIND = "payment";

interface PrefsRow {
  user_id: string;
  push_enabled: boolean;
}

/**
 * The alert's two lines.
 *
 * ONE VOCABULARY WITH THE TIMELINE. Every verb here is the one the thread
 * already uses for the same event (`thread.sysPaymentPaid` and its neighbours):
 * "paid", "went back to", "pulled back". A crew reading "Refunded" on the lock
 * screen and "went back to them" in the thread would be reading two glossaries
 * for one payment, which is the #273 failure this feature is otherwise careful
 * about.
 *
 * The contact's NAME rides in the title and survives a content withhold, the
 * same posture as the inbound alert: knowing WHO the money is about is most of
 * the triage value and carries far less exposure than what anybody said.
 */
export function paymentAlert(
  origin: string,
  input: PaymentNotification,
  contactName: string,
): PaymentAlert {
  const amount =
    input.amountCents !== null &&
    input.amountCents > 0 &&
    isBillingCurrency(input.currency)
      ? formatMoney(input.amountCents, input.currency)
      : null;

  const title = paymentTitle(input.outcome, contactName, amount);
  // Our own sentence per outcome, which is both the fallback when the ask had
  // no description and the replacement when content must not leave. One string
  // for both, because they are answering the same question: what can this
  // notification say when it cannot say what the money was for.
  const ourLine = OUR_LINE[input.outcome];
  const description = input.description?.trim() ?? "";
  return {
    title,
    body: description === "" ? ourLine : description,
    url: `${origin}/inbox/${input.conversationId}`,
    withheldBody: ourLine,
    collapseKey: `payment:${input.outcome}:${input.paymentRequestId}`,
  };
}

const OUR_LINE: Record<PaymentOutcome, string> = {
  paid: "The payment cleared.",
  refunded: "The refund has settled.",
  // Says where the next step is rather than what happened, because with a
  // dispute there IS a next step and it is not in this app — evidence goes to
  // Stripe, against a deadline Stripe sets.
  disputed: "Your Stripe dashboard has the details.",
};

function paymentTitle(
  outcome: PaymentOutcome,
  contact: string,
  amount: string | null,
): string {
  switch (outcome) {
    case "paid":
      return amount ? `${contact} paid ${amount}` : `${contact} paid`;
    case "refunded":
      return amount
        ? `${amount} went back to ${contact}`
        : `The money went back to ${contact}`;
    case "disputed":
      return amount
        ? `${contact}'s bank pulled back ${amount}`
        : `${contact}'s bank pulled this payment back`;
  }
}

function unwrapRows<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T[] {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

/**
 * Tell the crew their money moved.
 *
 * Throws on a delivery failure, like the assignment and inbound pipelines do,
 * so the caller decides what that means. The Connect webhook treats it as
 * best-effort: the money is already recorded and a Stripe redelivery would
 * resolve `already_paid` and send nothing, so failing the webhook would cost
 * the alert twice over.
 */
export async function notifyPayment(
  env: Env,
  input: PaymentNotification,
  db: SupabaseClient = getDb(env),
): Promise<void> {
  const conversations = unwrapRows<{ phone_number_id: string | null }>(
    await db
      .from("conversations")
      .select("phone_number_id")
      .eq("company_id", input.companyId)
      .eq("id", input.conversationId)
      .limit(1),
    "conversation lookup",
  );
  const conversation = conversations[0];
  // Gone between the payment and this running. Nothing to link to, so nothing
  // to say — and not an error: the money is recorded either way.
  if (!conversation) return;

  const viewers = await listConversationViewers(db, {
    companyId: input.companyId,
    phoneNumberId: conversation.phone_number_id,
  });
  const audience = viewers.map((row) => row.user_id);
  if (audience.length === 0) return;

  const prefRows = unwrapRows<PrefsRow>(
    await db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", input.companyId)
      .in("user_id", audience),
    "notification prefs lookup",
  );
  const prefs = new Map(prefRows.map((row) => [row.user_id, row]));
  // A missing row reads as the §6 defaults, which have push on.
  const pushUsers = audience.filter(
    (userId) => prefs.get(userId)?.push_enabled ?? true,
  );
  if (pushUsers.length === 0) return;

  const contactName = await conversationContactName(
    db,
    input.companyId,
    input.conversationId,
  );
  // No contact means the thread's customer row is gone. Every sentence this
  // alert can say names them, so there is nothing left to send.
  if (contactName === null) return;

  const alert = paymentAlert(env.APP_ORIGIN, input, contactName);
  const failures: unknown[] = [];
  await deliverPush(env, db, {
    category: "operational",
    companyId: input.companyId,
    conversationId: input.conversationId,
    userIds: pushUsers,
    content: {
      written: "people",
      companyId: input.companyId,
      withheld: { body: alert.withheldBody },
    },
    web: () => ({ title: alert.title, body: alert.body, url: alert.url }),
    // NATIVE only, like every other discriminator: the service worker has no
    // channels to pick from, so `kind` on the web payload would be a field
    // nothing reads.
    native: () => ({
      kind: PAYMENT_PUSH_KIND,
      title: alert.title,
      body: alert.body,
      url: alert.url,
    }),
    collapseKey: alert.collapseKey,
    failures,
  });

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `payment alert: ${failures.length} delivery step(s) failed for ${alert.collapseKey}`,
    );
  }
}
