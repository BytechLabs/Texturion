/**
 * #228 — the answer to AIDE, which is the one help request nobody else answers.
 *
 * Telnyx answers HELP and INFO at the network before we ever see them, which is
 * why `HELP_KEYWORDS` means "do not reply" rather than "reply". Its set is
 * English, so AIDE arrives here as an ordinary message. Before this it drew the
 * after-hours away reply if the shop happened to be closed, and nothing at all
 * if it was open: somebody asking how this works was answered with a message
 * about opening times, or with silence.
 *
 * WHY THE REPLY IS IN FRENCH REGARDLESS OF ANY SETTING. The keyword IS the
 * language signal, and it is a better one than either the workspace default or
 * the contact's own field. Somebody who types AIDE has told us what they read,
 * in the same message; answering that in English because a workspace setting
 * says English would be ignoring the clearest evidence available.
 *
 * WHAT IT SAYS, and why each part is there. A help reply exists to answer
 * "who is this and how do I make it stop":
 *
 *   names the business    a text from an unrecognised long code is otherwise
 *                         indistinguishable from spam
 *   says how to reach us  the honest answer to "aide" for a texting product is
 *                         that replying works
 *   rates may apply       the standard disclosure
 *   STOP, not ARRET       STOP is what the carrier's network matches. ARRET is
 *                         honoured (keywords.ts) but only because we match it
 *                         ourselves, so telling somebody to send the word that
 *                         works everywhere is the safer instruction
 *
 * Not a CWTA obligation: those rules bind short codes and this product sends on
 * long codes and toll-free. It is here because the alternative is answering a
 * question with the wrong answer.
 */
import { copyFor } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { guardedAutoSend, type AutoSendOutcome } from "./auto-send";
import { applySendMergeFields } from "./merge";
import { runPreSendGates } from "./send";

/**
 * One help reply per conversation per hour.
 *
 * The same window the emergency acknowledgment uses, and for a duller reason:
 * a keyword auto-responder with no throttle is a loop waiting for two of them
 * to find each other. Somebody who genuinely sends AIDE twice in an hour has
 * already been told the one thing this message knows.
 */
export const HELP_REPLY_THROTTLE_SECONDS = 60 * 60;

/**
 * Answer a French help request for a freshly-created inbound message.
 *
 * Best-effort by contract, like every other auto-reply: the inbound message is
 * already stored and threaded, and nothing here may wedge it in a retry loop.
 * The claim's throttle makes a webhook replay a no-op.
 */
export async function sendHelpReply(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    fromE164: string;
    triggerBody: string;
    /** The business name, for the one merge field this message carries. */
    businessName: string | null;
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
    throw new Error(`help reply conversation lookup failed: ${convError.message}`);
  }
  const conv = (convRows ?? [])[0] as unknown as
    | {
        phone_numbers: { number_e164: string | null; status: string } | null;
        contact_phone_e164: string | null;
      }
    | undefined;
  const from = conv?.phone_numbers?.number_e164;
  if (!conv || !from || conv.phone_numbers?.status !== "active") {
    // Nothing honest to say from a number that cannot send.
    return { sent: false, reason: "not_found" };
  }
  const to = conv.contact_phone_e164 ?? args.fromE164;

  // §7 send gates, same as every other send.
  const clearance = await runPreSendGates(env, args.companyId, to);

  // Always French: see the header. `copyFor` rather than `copyForContact`
  // because the workspace's language and this customer's stored language are
  // both weaker evidence than the word they just typed.
  const body = applySendMergeFields(copyFor("fr-CA").helpReply, {
    businessName: args.businessName,
  });

  return guardedAutoSend(env, db, {
    companyId: args.companyId,
    conversationId: args.conversationId,
    from,
    to,
    body,
    triggerBody: args.triggerBody,
    clearance,
    throttleSeconds: HELP_REPLY_THROTTLE_SECONDS,
    // `suppressesAutoReply` refuses AIDE so the away message cannot answer it.
    // This is the send that refusal exists to make room for.
    answersHelp: true,
  });
}
