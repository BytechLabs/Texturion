/**
 * #414 ask 4 — the one honest thing we can say to someone who replied URGENT.
 *
 * The ask, verbatim: "Never auto-reply to the emergency keyword with
 * reassurance. 'We'll call you shortly' sent by a robot to someone with a gas
 * smell is worse than silence. If we cannot guarantee a human, the honest
 * response names the alternative — the utility's emergency line, or 911."
 *
 * So this is not the away reply with different words. The away reply exists to
 * set an expectation; this exists to correct one. It promises no callback,
 * because we cannot guarantee a person is awake, and it names the two numbers
 * that are staffed at 3am when ours may not be.
 *
 * WHY IT IS NOT OWNER-AUTHORED, in a module whose stated principle is that the
 * owner controls what is promised: that principle is about not speaking for
 * the owner about their own availability. This is the product speaking about
 * its own limits — the one thing an owner cannot be asked to write, since
 * #414 exists precisely because owner-facing copy promised what no code
 * delivered. An editable version re-opens the hole. The owner's control here
 * is the switch that turns the whole mechanism off.
 */
import { estimateSegments } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { runPreSendGates } from "./send";
import { guardedAutoSend, type AutoSendOutcome } from "./auto-send";

/**
 * Exactly 159 GSM-7 characters — one segment, checked deliberately. A person
 * reading this on a cracked phone in a cold house should not receive it in two
 * pieces that arrive out of order, and the cheapest message is also the one
 * least likely to be truncated by a carrier along the way.
 *
 * Every clause earns its place:
 *   "Flagged as urgent"      — confirms the instruction worked. Without this
 *                              they do not know whether the word did anything.
 *   "the whole team has
 *    been alerted now"       — states what actually happened, which is true and
 *                              is NOT the same as "someone will call you".
 *   "If anyone is in danger
 *    or you smell gas"       — the two cases where waiting for us is the wrong
 *                              choice, in the words a person would recognise.
 *   "call 911 or your
 *    utility's emergency
 *    line"                   — the alternative the ask requires us to name.
 *   "Do not wait on us."     — the sentence that makes the rest honest.
 */
export const EMERGENCY_ACK_BODY =
  "Flagged as urgent - the whole team has been alerted now. " +
  "If anyone is in danger or you smell gas, call 911 or your utility's " +
  "emergency line. Do not wait on us.";

/**
 * One acknowledgment per conversation per hour. Shorter than the away reply's
 * three hours: a genuine emergency can escalate inside an evening, and a
 * customer who texts URGENT again an hour later has told us the first one went
 * unanswered.
 */
export const EMERGENCY_ACK_THROTTLE_SECONDS = 60 * 60;

/**
 * At most 50 acknowledgments per company per rolling 24 hours.
 *
 * This path is exempt from the outbound overage cap (see the migration for
 * why), and an exempt send path with no ceiling of its own is an uncapped cost
 * centre — the thing this product does not ship. So it carries its own. Fifty
 * emergencies in one day from a single workspace is an attack or a loop, not a
 * January cold snap; past it the SMS stops while the crew escalation does not.
 */
export const EMERGENCY_ACK_DAILY_CAP = 50;

/**
 * Send the emergency acknowledgment for a freshly-created inbound message.
 *
 * Best-effort by contract: the caller wraps this, because the inbound message
 * is already durable and threaded and nothing here may wedge it in a retry
 * loop. The claim's throttle makes a replay a no-op.
 */
export async function sendEmergencyAcknowledgment(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    fromE164: string;
    triggerBody: string;
  },
): Promise<AutoSendOutcome> {
  const { data: convRows, error: convError } = await db
    .from("conversations")
    .select("id,phone_numbers(number_e164,status),contacts(phone_e164)")
    .eq("company_id", args.companyId)
    .eq("id", args.conversationId)
    .limit(1);
  if (convError) {
    throw new Error(
      `emergency ack conversation lookup failed: ${convError.message}`,
    );
  }
  const conv = (convRows ?? [])[0] as unknown as
    | {
        phone_numbers: { number_e164: string | null; status: string } | null;
        contacts: { phone_e164: string } | null;
      }
    | undefined;
  const from = conv?.phone_numbers?.number_e164;
  if (!conv || !from || conv.phone_numbers?.status !== "active") {
    // No number to send from. The crew escalation already happened in the
    // caller and is the half that matters; there is nothing honest to say
    // here from a number that cannot send.
    return { sent: false, reason: "not_found" };
  }
  const to = conv.contacts?.phone_e164 ?? args.fromE164;

  // §7 send gates, same as every other send. A US destination on an
  // unapproved campaign is refused by the carrier, not by us — attempting it
  // anyway would burn the throttle on a message that never lands.
  const clearance = await runPreSendGates(env, args.companyId, to);

  return guardedAutoSend(env, db, {
    companyId: args.companyId,
    conversationId: args.conversationId,
    from,
    to,
    body: EMERGENCY_ACK_BODY,
    triggerBody: args.triggerBody,
    clearance,
    // No merge fields: {first_name} on a message about a gas leak reads as
    // marketing, and a dropped token would leave a ragged sentence in the one
    // message that has to be read correctly the first time.
    answersEmergency: true,
    throttleSeconds: EMERGENCY_ACK_THROTTLE_SECONDS,
    dailyCap: EMERGENCY_ACK_DAILY_CAP,
  });
}

/** Segment count for the fixed body — asserted by the tests, not guessed. */
export function emergencyAckSegments(): number {
  return Math.max(1, estimateSegments(EMERGENCY_ACK_BODY).segments);
}
