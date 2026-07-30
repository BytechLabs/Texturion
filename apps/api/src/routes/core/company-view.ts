/**
 * Company hydration shared by GET /v1/me and GET /v1/company (SPEC §7):
 * safe company columns (never Stripe/Telnyx internals) + numbers summary +
 * registration snapshot (brand and campaign rows).
 */
import {
  effectiveAwayMessage,
  effectiveMctbMessage,
  identificationSuffix,
  seatLimit,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../../env";
import { effectiveCnamDisplayName } from "../../telnyx/voice";

import { unwrap } from "./http";
import { resolveNumberAccess } from "../../auth/number-access";
import type { MemberRole } from "../../context";

/** Customer-visible company columns (SPEC §10: internals stay server-side). */
export const COMPANY_COLUMNS =
  "id,name,country,us_texting_enabled,requested_area_code,timezone,plan," +
  "subscription_status,current_period_start,current_period_end," +
  "overage_cap_multiplier,registration_fee_paid_at,canceled_at," +
  "cancel_at_period_end," +
  // FEATURE-GAPS Step 1: after-hours away settings. #414:
  // emergency_keyword_enabled belongs beside them because the away message is
  // what asks a customer to reply URGENT in the first place — the switch and
  // the promise have to be readable in one place, or an owner turns one off
  // and leaves the other making an offer nobody answers.
  "business_hours,business_hours_exceptions,away_enabled,away_message," +
  "emergency_keyword_enabled," +
  // #388: the unanswered-lead ladder switches.
  "lead_chase_enabled,lead_chase_crew_enabled," +
  // #430: whether a push may carry words a person typed. Workspace-wide on
  // purpose — the exposure is the CUSTOMER'S, so it is not each tech's call.
  "push_include_content," +
  // FEATURE-GAPS voice wave: missed-call text-back settings. (D43 deleted
  // forward_to_cell — the browser is the phone; the column is dropped.)
  "mctb_enabled,mctb_message," +
  // #393: whether a first outbound message carries sender identification.
  // Default false — D4's 2026-07 reversal stands until an owner opts in.
  "first_message_identification," +
  // #225: whether a person STARTING a conversation into a quiet destination
  // must confirm. Only that. Never read by an automated send path — see the
  // column comment and quiet-hours-confirm.test.ts.
  "quiet_hours_confirm_enabled," +
  // D43 Calls v2: voicemail greeting, screening routing, CNAM pair. #193:
  // cnam_submitted_at = when the effective listing last went to the carrier
  // side (CNAM propagation takes days and Telnyx reports no status, so the
  // timestamp IS the pending state).
  "voicemail_greeting,call_screening,cnam_display_name,caller_id_lookup," +
  "cnam_submitted_at," +
  // Choose-your-number: the staged onboarding pick, so the plan-step review can
  // show "your number" pre-checkout. Cleared once provisioning drains it.
  "chosen_number_e164," +
  // #314: the workspace's two-factor policy. The GRACE DEADLINE has to be
  // readable by every client, not just the owner's settings screen — a member
  // deserves to see the date before it arrives rather than discovering it as
  // a wall.
  "mfa_required_at,mfa_grace_until," +
  "created_at,updated_at";

// source + voice_enabled (FEATURE-GAPS voice wave): hosted-vs-purchased and
// voice status, so the web can label keep-your-number rows. failure_reason
// (aliased from provision_failure_reason) + provision_attempts let the app-wide
// banner + the onboarding setting-up checklist branch honestly on a
// provision_failed number — the field name matches GET /v1/numbers' sanitized
// shape. The raw last_provision_error + telnyx_* ids are never selected here.
const NUMBER_COLUMNS =
  "id,status,source,voice_enabled,country,number_e164,requested_area_code," +
  "created_at,failure_reason:provision_failure_reason,provision_attempts";

const REGISTRATION_COLUMNS =
  "kind,status,sole_proprietor,rejection_reason,submission_count," +
  "submitted_at,approved_at,rejected_at,deactivated_at";

interface RegistrationRow {
  kind: "brand" | "campaign";
  [key: string]: unknown;
}

export interface CompanyView {
  [key: string]: unknown;
  numbers: unknown[];
  /** #192: the text-back template that will actually be sent — the owner's
   *  non-blank text, else the product default. Clients render/preview THIS,
   *  never a client-side copy of the default. */
  mctb_effective_message: string;
  /** #192: true when the owner's own text is in effect (mctb_message
   *  non-blank); false means the product default ships. */
  mctb_message_is_custom: boolean;
  /** #393: the EXACT suffix a first outbound message will carry, or null when
   *  the setting is off (or the company has no usable name). Clients append
   *  this string for the composer preview and count its segments — they must
   *  never compose it themselves, because a client-side copy that drifts from
   *  the server's would show a segment count the customer is not billed. */
  first_message_identification_suffix: string | null;
  /** #193: the outbound caller ID actually in effect — the explicit
   *  cnam_display_name when set, else the company name sanitized to the
   *  carrier CNAM alphabet. null only when neither yields a listable name. */
  caller_id_effective: string | null;
  /** #193: where caller_id_effective came from — 'company_name' is the
   *  platform default; 'custom' means the owner set one deliberately. */
  caller_id_source: "custom" | "company_name";
  /** #133: live module ids (e.g. 'voice') — the MEMBER-visible on/off state.
   *  Every calling surface gates on this; GET /v1/billing/modules is
   *  admin-only (it carries billing detail), and gating member UI on it made
   *  every member read as module-off (the tel: personal-cell leak). */
  enabled_modules: string[];
  /** #163: false = native apps hide in-app billing WRITES (plan change,
   *  module toggles) and route everything to the external-browser Stripe
   *  surfaces — the store-rules kill-switch. Config, not a DB column. */
  billing_writes_enabled: boolean;
  registration: {
    brand: RegistrationRow | null;
    campaign: RegistrationRow | null;
  };
}

/**
 * #163: in-app billing writes are enabled unless the BILLING_WRITES_DISABLED
 * kill-switch is flipped ("1"/"true"). Lagging clients that predate the field
 * default it to true, so the switch only ever REMOVES affordances.
 */
export function billingWritesEnabled(env: Env): boolean {
  const raw = env.BILLING_WRITES_DISABLED?.trim().toLowerCase() ?? "";
  return raw !== "1" && raw !== "true";
}

/**
 * #192: stamp the derived text-back fields on a raw companies row — the
 * EFFECTIVE template (owner's non-blank text, else the product default) and
 * whether it is custom. Applied to every surface that returns company
 * settings (GET /v1/me, GET /v1/company, PATCH /v1/company) so clients never
 * hardcode the default.
 */
export function withMctbDerived<T extends Record<string, unknown>>(
  company: T,
): T & { mctb_effective_message: string; mctb_message_is_custom: boolean } {
  const effective = effectiveMctbMessage(
    typeof company.mctb_message === "string" ? company.mctb_message : null,
  );
  return {
    ...company,
    mctb_effective_message: effective.message,
    mctb_message_is_custom: effective.custom,
  };
}

/**
 * #393: the exact identification suffix a first outbound message will carry,
 * or null when the setting is off.
 *
 * Derived server-side for the same reason as the text-back template above: the
 * clients render a preview and count its segments, and a client-side copy of
 * this string that drifted from the server's would show the customer a segment
 * count they are not billed for. One source of truth, handed over the wire.
 */
export function withIdentificationDerived<T extends Record<string, unknown>>(
  company: T,
): T & { first_message_identification_suffix: string | null } {
  const enabled = company.first_message_identification === true;
  const name = typeof company.name === "string" ? company.name : null;
  return {
    ...company,
    first_message_identification_suffix: enabled
      ? identificationSuffix(name)
      : null,
  };
}

/**
 * #414 ask 5: the away-reply twin of {@link withMctbDerived}.
 *
 * Three clients each carried their own copy of the default away message and
 * previewed it, while the server sent nothing at all when the owner had not
 * written one. Resolving it here makes the Preview panel show what will
 * actually send, and lets the clients delete their literals — nothing kept
 * those three strings equal but luck.
 */
export function withAwayDerived<T extends Record<string, unknown>>(
  company: T,
): T & { away_effective_message: string; away_message_is_custom: boolean } {
  const effective = effectiveAwayMessage(
    typeof company.away_message === "string" ? company.away_message : null,
  );
  return {
    ...company,
    away_effective_message: effective.message,
    away_message_is_custom: effective.custom,
  };
}

/**
 * #193: stamp the derived caller ID fields on a raw companies row — the
 * EFFECTIVE outbound display name (explicit cnam_display_name, else the
 * company name in the carrier alphabet) and its source. Applied everywhere
 * company settings are returned (GET /v1/me, GET /v1/company,
 * PATCH /v1/company) so every client shows the same default.
 */
export function withCallerIdDerived<T extends Record<string, unknown>>(
  company: T,
): T & {
  caller_id_effective: string | null;
  caller_id_source: "custom" | "company_name";
} {
  const custom =
    typeof company.cnam_display_name === "string" &&
    company.cnam_display_name.length > 0;
  return {
    ...company,
    caller_id_effective: effectiveCnamDisplayName({
      name: company.name as string | null | undefined,
      cnam_display_name: company.cnam_display_name as
        | string
        | null
        | undefined,
    }),
    caller_id_source: custom ? "custom" : "company_name",
  };
}

/**
 * Fetch the company (soft-deleted companies read as absent), its number list,
 * and its registration snapshot. Returns null when no live company exists.
 */
export async function loadCompanyView(
  db: SupabaseClient,
  companyId: string,
  env: Env,
  // #106: the caller's identity, so a restricted member's hidden numbers are
  // filtered out of the returned list (this view is embedded in GET /v1/company
  // AND GET /v1/me — the hottest hydration path). Owners/admins + no-rules
  // companies resolve unrestricted, so there's no extra query for them.
  caller: { userId: string; role: MemberRole },
): Promise<CompanyView | null> {
  const companies = unwrap<Record<string, unknown>[]>(
    await db
      .from("companies")
      .select(COMPANY_COLUMNS)
      .eq("id", companyId)
      .is("deleted_at", null)
      .limit(1),
    "company lookup",
  );
  const company = companies[0];
  if (!company) return null;

  // These three depend only on companyId (not on the company row) and are merged
  // at the end — run them in ONE parallel round-trip instead of three serial
  // ones. This is the hottest hydration path (every /company load), so the
  // saved latency is real and there's no ongoing cost.
  const [numbersRes, registrationsRes, modulesRes, access] = await Promise.all([
    db
      .from("phone_numbers")
      .select(NUMBER_COLUMNS)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true }),
    db
      .from("messaging_registrations")
      .select(REGISTRATION_COLUMNS)
      .eq("company_id", companyId),
    db
      .from("company_modules")
      .select("module")
      .eq("company_id", companyId)
      .is("disabled_at", null),
    resolveNumberAccess(db, { companyId, userId: caller.userId, role: caller.role }),
  ]);
  const allNumbers = unwrap<unknown[]>(numbersRes, "phone_numbers lookup");
  // #106: drop numbers hidden from this member (mirrors GET /v1/numbers). Null
  // hiddenNumberIds = unrestricted (owner/admin, or no access rules) → no-op.
  const hidden = access.hiddenNumberIds;
  const numbers =
    hidden === null
      ? allNumbers
      : allNumbers.filter((n) => !hidden.includes((n as { id: string }).id));
  const registrations = unwrap<RegistrationRow[]>(
    registrationsRes,
    "messaging_registrations lookup",
  );
  const modules = unwrap<{ module: string }[]>(
    modulesRes,
    "company_modules lookup",
  );

  return {
    ...withSeatDerived(
      withCallerIdDerived(
        withMctbDerived(withAwayDerived(withIdentificationDerived(company))),
      ),
    ),
    numbers,
    enabled_modules: modules.map((row) => row.module),
    billing_writes_enabled: billingWritesEnabled(env),
    registration: {
      brand: registrations.find((row) => row.kind === "brand") ?? null,
      campaign: registrations.find((row) => row.kind === "campaign") ?? null,
    },
  };
}

/**
 * #392: the seat allowance, served rather than recomputed.
 *
 * Starter 3 / Pro 15 was hardcoded on the API, web, Android and iOS. A pricing
 * lever that requires an App Store review before it is true everywhere is not
 * a lever. Sending the number means a client renders server truth and can
 * never show a figure the API will refuse — the failure that reads as a bug at
 * the exact moment an owner is trying to add somebody.
 */
export function withSeatDerived<T extends Record<string, unknown>>(
  company: T,
): T & { seat_limit: number } {
  return {
    ...company,
    seat_limit: seatLimit(
      typeof company.plan === "string" ? company.plan : null,
    ),
  };
}
