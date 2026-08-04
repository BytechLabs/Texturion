/**
 * After-hours / away auto-reply (FEATURE-GAPS Step 1). Called from the inbound
 * pipeline after threading, only on the FIRST delivery of a new inbound message
 * (threaded.created). It sends ONE owner-authored away message when:
 *   - away_enabled is on AND a non-empty away_message is authored, AND
 *   - the inbound arrived OUTSIDE THE RECEIVING LINE's business hours, in that
 *     line's own timezone — a DIFFERENT clock than per-contact quiet hours
 *     (FEATURE-GAPS §2). #307: the toggle, the zone and the hours all resolve
 *     per number, falling back to the company's, so a service line and a sales
 *     line in one workspace can keep different schedules, AND
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
import {
  effectiveAwayMessage,
  isAfterHours,
  type BusinessHours,
  type HoursException,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveNumberIdentity } from "@loonext/shared";

import type { Env } from "../env";
import { runPreSendGates } from "./send";
import { guardedAutoSend } from "./auto-send";
import { applySendMergeFields } from "./merge";

interface AwaySettings {
  timezone: string;
  business_hours: BusinessHours | null;
  /** #402: dates that override the weekly loop — Christmas is not a Thursday. */
  business_hours_exceptions: HoursException[] | null;
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
  // #307: the company read no longer decides anything ALONE, so it can no
  // longer short-circuit ahead of the number. Both reads are independent, so
  // they go together — one round trip where the old order paid two, which is
  // what buys back the read a company with away switched off used to skip.
  const [company, conversation] = await Promise.all([
    db
      .from("companies")
      .select(
        // One literal, deliberately: splitting it with `+` defeats the client's
        // literal-type inference and the row stops being assignable.
        "timezone,business_hours,business_hours_exceptions,away_enabled,away_message,name",
      )
      .eq("id", args.companyId)
      .limit(1),
    db
      .from("conversations")
      .select(
        // #291: `contact_phone_e164` is the number this THREAD is with. The
        // contact is still read for the name that goes in the merge.
        // #307: the LINE's own hours, zone, toggle and message ride the embed
        // we already make, so per-number away costs no extra read.
        "id,contact_phone_e164," +
          "phone_numbers(number_e164,status,label,away_message,away_enabled," +
          "timezone,business_hours,business_hours_exceptions)," +
          "contacts(name)",
      )
      .eq("company_id", args.companyId)
      .eq("id", args.conversationId)
      .limit(1),
  ]);
  if (company.error) {
    throw new Error(`away settings lookup failed: ${company.error.message}`);
  }
  if (conversation.error) {
    throw new Error(`away conversation lookup failed: ${conversation.error.message}`);
  }
  const settings = (company.data ?? [])[0] as AwaySettings | undefined;
  if (!settings) return;
  const conv = (conversation.data ?? [])[0] as unknown as
    | {
        contact_phone_e164: string | null;
        phone_numbers: {
          number_e164: string | null;
          status: string;
          label: string | null;
          away_message: string | null;
          away_enabled: boolean | null;
          timezone: string | null;
          business_hours: BusinessHours | null;
          business_hours_exceptions: HoursException[] | null;
        } | null;
        contacts: { name: string | null } | null;
      }
    | undefined;
  const fromNumber = conv?.phone_numbers?.number_e164;
  if (!conv || !fromNumber || conv.phone_numbers?.status !== "active") {
    return; // number not ready → nothing to send from
  }
  const slice: ConvSendSlice = {
    from: fromNumber,
    to: conv.contact_phone_e164 ?? args.fromE164,
    contactName: conv.contacts?.name ?? null,
  };

  /**
   * #307 — the LINE's identity, with the company's as the default.
   *
   * A number with no overrides resolves to exactly the company values used
   * before, which is every number until somebody sets one.
   *
   * The toggle, the zone and the hours are all resolved HERE rather than read
   * off the company, because the whole point of the issue is that a service
   * line and a sales line keep different hours. Resolving the message but not
   * the clock would send the sales line's after-hours text on the service
   * line's schedule — worse than not supporting it at all, because it looks
   * configured.
   */
  const identity = resolveNumberIdentity(
    {
      name: settings.name,
      timezone: settings.timezone,
      voicemailGreeting: null,
      awayMessage: settings.away_message,
      awayEnabled: settings.away_enabled,
      businessHours: settings.business_hours,
      businessHoursExceptions: settings.business_hours_exceptions,
      // Not read on this path — mctb resolves where the missed call is
      // handled. Passed because CompanyIdentity is one shape: a resolver with
      // optional halves would let a caller forget the half it does need.
      mctbEnabled: false,
      mctbMessage: null,
      // Not read on this path — the recording is resolved where the greeting
      // actually plays (greetingAudioUrl), and #278's routing is decided where
      // the CALL is answered. Passed because CompanyIdentity is one shape: a
      // resolver with optional halves would let a caller forget the half it
      // does need.
      voicemailGreetingId: null,
      afterHoursCalls: "ring_everyone",
      afterHoursGreetingId: null,
      ringStrategy: "all",
      ringSeconds: 45,
    },
    {
      label: conv.phone_numbers?.label ?? null,
      awayMessage: conv.phone_numbers?.away_message ?? null,
      awayEnabled: conv.phone_numbers?.away_enabled ?? null,
      timezone: conv.phone_numbers?.timezone ?? null,
      businessHours: conv.phone_numbers?.business_hours ?? null,
      businessHoursExceptions:
        conv.phone_numbers?.business_hours_exceptions ?? null,
    },
  );

  // The toggle decides WHETHER an away reply happens at all — for this line.
  if (!identity.awayEnabled.value) return;

  // #414 ask 5: blank no longer means silence. The message always exists,
  // resolving to the product default — the same contract MCTB has had since
  // #192. Before this, an owner who switched away replies on without writing
  // anything got a Preview of the default on all three clients and a customer
  // who got nothing.
  const { message } = effectiveAwayMessage(identity.awayMessage.value);

  // The away CLOCK: outside THIS LINE's business hours in THIS LINE's timezone
  // (not the contact's — FEATURE-GAPS §2). An unresolvable zone returns "open"
  // so we never auto-send when we cannot place the instant.
  // #402: a date exception replaces the weekday entirely, so a shop closed for
  // Christmas is after-hours on a Thursday the weekly loop calls a working day.
  // This is the case the away-reply matters MOST for — on an ordinary evening
  // the customer knows why nobody replied; on a holiday, silence is ambiguous
  // and they resolve it by calling somebody else.
  if (
    !isAfterHours(
      identity.timezone.value,
      (identity.businessHours.value as BusinessHours | null) ?? {},
      args.atUtc,
      identity.businessHoursExceptions.value as HoursException[] | null,
    )
  ) {
    return;
  }

  // §7 send gates (subscription active, US/CA destination registration-clear).
  // These are per-destination and would 403/402 a not-ready send; a throw here
  // is caught by the caller and the inbound ingest is unaffected.
  const clearance = await runPreSendGates(env, args.companyId, slice.to);

  // Merge fields into the owner-authored away message at send time.
  const body = applySendMergeFields(identity.awayMessage.value ?? message, {
    contactName: slice.contactName,
    businessName: identity.label.value,
  });

  await guardedAutoSend(env, db, {
    companyId: args.companyId,
    conversationId: args.conversationId,
    from: slice.from,
    to: slice.to,
    body,
    triggerBody: args.triggerBody,
    clearance,
  });
}
