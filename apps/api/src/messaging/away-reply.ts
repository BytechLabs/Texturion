/**
 * After-hours / away auto-reply (FEATURE-GAPS Step 1). Called from the inbound
 * pipeline after threading, only on the FIRST delivery of a new inbound message
 * (threaded.created). It sends ONE owner-authored away message when:
 *   - away_enabled is on AND a non-empty away_message is authored, AND
 *   - the inbound arrived OUTSIDE the company's business hours (company-local
 *     via companies.timezone — a DIFFERENT clock than per-contact quiet hours,
 *     FEATURE-GAPS §2), AND
 *   - the shared auto-send guard passes (not opted out, not a STOP/HELP keyword,
 *     not throttled — the guard's per-conversation throttle is what enforces
 *     "one away reply per burst / per conversation window").
 *
 * The away message is OWNER-AUTHORED and emergency-aware — we NEVER hard-code
 * "we're closed" (DECISIONS / FEATURE-GAPS §2). Merge-fields are applied at send
 * time. Reply-exempt under D4 (the customer started the thread); the opt-out
 * mirror is still honored (inside the guard).
 *
 * Best-effort: any failure here is logged and swallowed so it never breaks the
 * inbound ingest (the message is already stored + threaded). The guard's own
 * throttle makes a sweeper replay safe (a re-run within the window is throttled).
 */
import { isAfterHours, type BusinessHours } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { runPreSendGates } from "./send";
import { guardedAutoSend } from "./auto-send";
import { applySendMergeFields } from "./merge";

interface AwaySettings {
  timezone: string;
  business_hours: BusinessHours | null;
  away_enabled: boolean;
  away_message: string | null;
  name: string;
}

interface ConvSendSlice {
  from: string;
  to: string;
  contactName: string | null;
}

/**
 * Attempt the after-hours away-reply for a freshly-created inbound message.
 * `triggerBody` is the inbound text (used for the STOP/HELP keyword short-
 * circuit). `atUtc` is the message arrival instant (injected for testability).
 */
export async function maybeSendAwayReply(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    fromE164: string;
    triggerBody: string;
    atUtc: Date;
  },
): Promise<void> {
  // Company away settings — one small read. away_enabled short-circuits before
  // any other work so companies without the feature pay nothing.
  const { data: companyRows, error: companyError } = await db
    .from("companies")
    .select(
      "timezone,business_hours,away_enabled,away_message,name",
    )
    .eq("id", args.companyId)
    .limit(1);
  if (companyError) {
    throw new Error(`away settings lookup failed: ${companyError.message}`);
  }
  const settings = (companyRows ?? [])[0] as AwaySettings | undefined;
  if (!settings || !settings.away_enabled) return;

  const message = (settings.away_message ?? "").trim();
  if (message.length === 0) return; // enabled but unauthored → send nothing

  // The away CLOCK: outside business hours in the COMPANY timezone (not the
  // contact's — FEATURE-GAPS §2). An unresolvable zone returns "open" so we
  // never auto-send when we cannot place the instant.
  if (!isAfterHours(settings.timezone, settings.business_hours ?? {}, args.atUtc)) {
    return;
  }

  // Resolve the sending number + destination + contact name for the merge.
  const { data: convRows, error: convError } = await db
    .from("conversations")
    .select(
      "id,phone_numbers(number_e164,status),contacts(name,phone_e164)",
    )
    .eq("company_id", args.companyId)
    .eq("id", args.conversationId)
    .limit(1);
  if (convError) {
    throw new Error(`away conversation lookup failed: ${convError.message}`);
  }
  const conv = (convRows ?? [])[0] as unknown as
    | {
        phone_numbers: { number_e164: string | null; status: string } | null;
        contacts: { name: string | null; phone_e164: string } | null;
      }
    | undefined;
  const fromNumber = conv?.phone_numbers?.number_e164;
  if (!conv || !fromNumber || conv.phone_numbers?.status !== "active") {
    return; // number not ready → nothing to send from
  }
  const slice: ConvSendSlice = {
    from: fromNumber,
    to: conv.contacts?.phone_e164 ?? args.fromE164,
    contactName: conv.contacts?.name ?? null,
  };

  // §7 send gates (subscription active, US/CA destination registration-clear).
  // These are per-destination and would 403/402 a not-ready send; a throw here
  // is caught by the caller and the inbound ingest is unaffected.
  await runPreSendGates(env, args.companyId, slice.to);

  // Merge fields into the owner-authored away message at send time.
  const body = applySendMergeFields(message, {
    contactName: slice.contactName,
    businessName: settings.name,
  });

  await guardedAutoSend(env, db, {
    companyId: args.companyId,
    conversationId: args.conversationId,
    from: slice.from,
    to: slice.to,
    body,
    triggerBody: args.triggerBody,
  });
}
