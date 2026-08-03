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
 * because we cannot guarantee a person is awake.
 *
 * #460 SPLIT IT, and the split is the point. This module used to argue that
 * because the safety property is ours, the whole message had to be — "an
 * editable version re-opens the hole". That conclusion was too broad, and the
 * cost of it was a plumber's sentence ("you smell gas", "your utility's
 * emergency line") auto-sent on behalf of locksmiths, landscapers and mobile
 * mechanics. The founder called that out and was right: assuming somebody's
 * trade is its own kind of dishonesty.
 *
 * The body is now the owner's, and `emergencyReplyBody` always appends
 * {@link EMERGENCY_SAFETY_LINE}, which no setting can remove. The owner controls
 * what is promised; they do not control whether the alternative is named,
 * because the person reading it may be in danger and did not choose this vendor.
 * The safety property survives with a narrower blast radius than "we write
 * everything".
 */
import { emergencyReplyBody, estimateSegments } from "@loonext/shared";

/**
 * Re-exported so the one sentence with a safety property has a home in the
 * module that enforces it. `emergencyReplyBody` appends this to whatever an
 * owner wrote and no setting removes it (#414 ask 4, narrowed by #460).
 */
export { EMERGENCY_SAFETY_LINE } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { runPreSendGates } from "./send";
import { guardedAutoSend, type AutoSendOutcome } from "./auto-send";

/**
 * The default reply, for a workspace that has not written its own. One GSM-7
 * segment, asserted by the tests rather than hoped for: a person reading this on
 * a cracked phone in a cold house should not receive it in two pieces that
 * arrive out of order.
 *
 * Every clause still earns its place, and none of them names a trade:
 *   "Flagged as urgent"      — confirms the instruction worked. Without this
 *                              they do not know whether the word did anything.
 *   "the whole team has
 *    been alerted now"       — states what actually happened, which is true and
 *                              is NOT the same as "someone will call you".
 *   "Do not wait on us."     — the sentence that makes the rest honest.
 *   "If anyone is in danger,
 *    call 911."              — the alternative the ask requires us to name, and
 *                              the half an owner cannot edit away. 911 is the
 *                              emergency number in both markets we sell to.
 */
export const EMERGENCY_ACK_BODY = emergencyReplyBody(null);

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
    /**
     * #460: the workspace's own emergency reply, or null/blank for the product
     * default. Passed in rather than re-read here — the inbound handler already
     * has the company row, and a second round trip on the emergency path is the
     * one place to not spend a network call.
     */
    ownerMessage?: string | null;
  },
): Promise<AutoSendOutcome> {
  const { data: convRows, error: convError } = await db
    .from("conversations")
    // #291: the thread's number, not the contact's primary.
    .select("id,contact_phone_e164,phone_numbers(number_e164,status)")
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
        contact_phone_e164: string | null;
      }
    | undefined;
  const from = conv?.phone_numbers?.number_e164;
  if (!conv || !from || conv.phone_numbers?.status !== "active") {
    // No number to send from. The crew escalation already happened in the
    // caller and is the half that matters; there is nothing honest to say
    // here from a number that cannot send.
    return { sent: false, reason: "not_found" };
  }
  const to = conv.contact_phone_e164 ?? args.fromE164;

  // §7 send gates, same as every other send. A US destination on an
  // unapproved campaign is refused by the carrier, not by us — attempting it
  // anyway would burn the throttle on a message that never lands.
  const clearance = await runPreSendGates(env, args.companyId, to);

  return guardedAutoSend(env, db, {
    companyId: args.companyId,
    conversationId: args.conversationId,
    from,
    to,
    body: emergencyReplyBody(args.ownerMessage),
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
export function emergencyAckSegments(ownerMessage?: string | null): number {
  return Math.max(
    1,
    estimateSegments(emergencyReplyBody(ownerMessage)).segments,
  );
}
