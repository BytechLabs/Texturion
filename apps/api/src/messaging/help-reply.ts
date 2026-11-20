import { copyFor } from "@loonext/shared";
import type { Locale } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { guardedAutoSend } from "./auto-send";
import type { AutoSendOutcome } from "./auto-send";
import { applySendMergeFields } from "./merge";
import { runPreSendGates } from "./send";

/** One copy of the same help reply per conversation per hour. */
export const HELP_REPLY_THROTTLE_SECONDS = 60 * 60;

/** Reply in the language of the keyword when the carrier leaves it to the app. */
export async function sendHelpReply(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    fromE164: string;
    triggerBody: string;
    locale: Locale;
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

  const body = applySendMergeFields(copyFor(args.locale).helpReply, {
    businessName: args.businessName?.trim() || from,
    ourNumber: from,
  });

  return guardedAutoSend(env, db, {
    automation: "help_reply",
    companyId: args.companyId,
    conversationId: args.conversationId,
    from,
    to,
    body,
    triggerBody: args.triggerBody,
    clearance,
    throttleSeconds: HELP_REPLY_THROTTLE_SECONDS,
  });
}
