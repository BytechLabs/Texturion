import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { guardedAutoSend } from "./auto-send";
import { runPreSendGates } from "./send";

/**
 * #481 — tell a departing business's customers where it went, while we still
 * hold the number.
 *
 * When a workspace cancels, the number goes back to the carrier after thirty
 * days and is eventually sold to somebody else. Their customers keep texting it
 * for years — it is saved in phones, printed on invoices, in old search
 * results — and after release they reach a stranger. #413 warns the owner that
 * this will happen. This is the half that helps.
 *
 * # Four things this is careful about
 *
 * THE WORDS ARE THEIRS. Every other automated send in this product is a message
 * the business wrote. A sentence we composed and sent to people who never
 * agreed to hear from us would be us speaking for a company that has left, so
 * the copy is the owner's and nothing is sent without an opt-in recorded
 * beside it.
 *
 * ONCE PER CONTACT, FOR THE WHOLE WINDOW. Not once per burst. Somebody who
 * texts in week one and again in week three has already been told; telling them
 * twice is us using a departed business's line to talk to its customers
 * repeatedly, which is the thing that would make this feel like spam rather
 * than a courtesy. Recorded on the conversation, not inferred from a clock.
 *
 * IT CANNOT OUTLIVE OUR CONTROL OF THE NUMBER. Checked inside the gate, where
 * the exemption is granted, rather than here — a caller cannot claim it.
 *
 * IT IS STILL GATED. The subscription check is the only one relaxed. Opt-out,
 * NANP and registration all still run: a contact who sent STOP hears nothing,
 * ever, and a departure is not a reason to make an exception to that.
 *
 * Best-effort, like the away reply: any failure is swallowed so it can never
 * break the inbound ingest. The message is already stored and threaded, and a
 * courtesy that takes down delivery is not a courtesy.
 */

/**
 * How many contacts one departing workspace may be told about.
 *
 * The off-ramp is FREE — the argument for charging is real carrier cost after
 * the subscription ended, and the argument against it is #399: being the vendor
 * who was straight with you on the way out is the referral channel, and
 * invoicing somebody for a courtesy as they leave is the story they tell
 * instead. At roughly a cent a message this ceiling is worth a couple of
 * dollars per departure, which is the cheapest goodwill this product can buy.
 *
 * Bounded rather than unlimited, per the cost posture: a number being hammered
 * by a spammer during the grace window must not turn a free courtesy into an
 * open bill. Past the ceiling nothing is sent, which is exactly the behaviour
 * that existed before this feature.
 */
export const MAX_OFFRAMP_REPLIES = 500;

interface OffRampSettings {
  offramp_message: string | null;
  offramp_opted_in_at: string | null;
  subscription_status: string;
}

/**
 * Send the off-ramp reply for one inbound message, if this workspace is
 * departing, opted in, and this contact has not been told yet.
 */
export async function maybeSendOffRamp(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    /** The workspace's own number the customer texted. */
    from: string;
    /** The customer. */
    to: string;
    /** What they sent — the guard reads it for STOP/HELP. */
    triggerBody: string;
  },
): Promise<void> {
  try {
    const { data: rows, error } = await db
      .from("companies")
      .select("offramp_message,offramp_opted_in_at,subscription_status")
      .eq("id", args.companyId)
      .limit(1);
    if (error || !rows?.length) return;
    const settings = rows[0] as OffRampSettings;

    // Re-checked here as well as by the caller. The caller skips this function
    // entirely for an active workspace so the hot path costs nothing, and this
    // is the check that holds if a second caller ever appears — the same
    // ask-and-verify shape as the gate exemption itself.
    if (settings.subscription_status === "active") return;
    if (!settings.offramp_opted_in_at || !settings.offramp_message?.trim()) return;

    // Already told. Read before anything expensive, because on a busy departing
    // number this is the branch that runs most.
    const { data: conv } = await db
      .from("conversations")
      .select("offramp_sent_at")
      .eq("id", args.conversationId)
      .limit(1);
    if (conv?.[0] && (conv[0] as { offramp_sent_at: string | null }).offramp_sent_at) {
      return;
    }

    const { count } = await db
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", args.companyId)
      .not("offramp_sent_at", "is", null);
    if ((count ?? 0) >= MAX_OFFRAMP_REPLIES) return;

    // The exemption is REQUESTED here and granted there. Everything else the
    // gate checks still applies.
    const clearance = await runPreSendGates(env, args.companyId, args.to, true);

    // Stamped BEFORE the send, deliberately. A crash between dispatching and
    // recording would otherwise let the next inbound send a second copy, and
    // for this message a duplicate is worse than a miss: the failure mode of
    // "told twice" is the one that reads as spam, and the failure mode of
    // "never told" is the world as it was before this feature.
    await db
      .from("conversations")
      .update({ offramp_sent_at: new Date().toISOString() })
      .eq("id", args.conversationId);

    await guardedAutoSend(env, db, {
      companyId: args.companyId,
      conversationId: args.conversationId,
      from: args.from,
      to: args.to,
      body: settings.offramp_message.trim(),
      triggerBody: args.triggerBody,
      clearance,
    });
  } catch (cause) {
    // Swallowed on purpose — see the docblock. The inbound message is already
    // stored and threaded, and this is a courtesy.
    console.error(
      `off-ramp reply failed for company ${args.companyId}: ${String(cause)}`,
    );
  }
}
