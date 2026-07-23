/**
 * Voice enablement for the missed-call text-back (FEATURE-GAPS voice wave,
 * Step 1a). A shipped number is SMS-ONLY: the §4.3 number order used
 * filter[features]=sms and attached only a messaging_profile_id, so the number
 * cannot receive calls. To route inbound calls into our Call-Control webhook we
 * bind the number's VOICE settings to the shared Telnyx Call-Control
 * application (TELNYX_VOICE_CONNECTION_ID).
 *
 * This is an IDEMPOTENT, SMS-SAFE enable-path for existing SMS-only numbers:
 *   - it PATCHes only `connection_id` on the phone-number resource (the
 *     voice-settings sub-resource's update schema does not accept it);
 *     messaging_profile_id is a different field and is never sent, so SMS
 *     keeps working exactly as before;
 *   - it is a no-op when the row is already voice_enabled (the flag guard) or
 *     already bound to our connection on the Telnyx side (the settings read);
 *   - it needs the number's Telnyx phone-number resource id, which the §4.3
 *     saga persisted as telnyx_phone_number_id.
 *
 * Enabling voice is what makes the missed-call text-back possible; without it a
 * call to the number is rejected by the carrier and no Call-Control webhook ever
 * fires. Callers turn it on when the owner enables the feature (settings PATCH)
 * or sets a forward_to_cell.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { telnyxRequest } from "./client";
import { getDb } from "../db";
import type { Env } from "../env";

interface VoiceSettingsResponse {
  data?: { connection_id?: string | null };
}

interface PhoneNumberUpdateResponse {
  data?: { connection_id?: string | null };
}

export interface VoiceEnableResult {
  /** True when this call changed state (bound voice + stamped the row). */
  changed: boolean;
  /** The Call-Control connection id now bound to the number. */
  connectionId: string;
  /** The reason nothing changed, when changed=false. */
  reason?: "already_enabled" | "already_bound";
}

/** The phone_numbers slice the voice-enable path reads/writes. */
export interface VoiceNumberRow {
  id: string;
  company_id: string;
  status: string;
  number_e164: string | null;
  telnyx_phone_number_id: string | null;
  voice_connection_id: string | null;
  voice_enabled: boolean;
}

export const VOICE_NUMBER_COLUMNS =
  "id,company_id,status,number_e164,telnyx_phone_number_id," +
  "voice_connection_id,voice_enabled";

/**
 * Bind the shared Call-Control application to a number's voice settings, once.
 * Idempotent on both sides: the local `voice_enabled` flag short-circuits an
 * already-enabled row, and the Telnyx voice-settings read short-circuits a
 * number already pointing at our connection (a re-run after a crash between the
 * PATCH and the DB stamp). Only the voice facet is touched — SMS is untouched.
 *
 * A number that has not finished provisioning (no telnyx_phone_number_id yet)
 * cannot be voice-bound; the caller enables voice after the number is active.
 */
export async function enableVoiceOnNumber(
  env: Env,
  db: SupabaseClient,
  row: VoiceNumberRow,
): Promise<VoiceEnableResult> {
  const connectionId = env.TELNYX_VOICE_CONNECTION_ID;

  // Local idempotency: already enabled to our connection → nothing to do.
  if (row.voice_enabled && row.voice_connection_id === connectionId) {
    return { changed: false, connectionId, reason: "already_enabled" };
  }
  if (!row.telnyx_phone_number_id) {
    throw new Error(
      `enableVoiceOnNumber: number ${row.id} has no telnyx_phone_number_id (not provisioned yet)`,
    );
  }

  // Telnyx-side idempotency: read the number's voice settings; if already bound
  // to our connection (a crash between PATCH and stamp), skip the PATCH and just
  // stamp the row. The voice-settings READ (PhoneNumberWithVoiceSettings) does
  // include connection_id.
  const settings = await telnyxRequest<VoiceSettingsResponse>(env, {
    method: "GET",
    path: `/v2/phone_numbers/${row.telnyx_phone_number_id}/voice`,
  });
  const alreadyBound = settings.data?.connection_id === connectionId;

  if (!alreadyBound) {
    // Bind the Call-Control connection via the PHONE-NUMBER resource — the
    // voice-settings sub-resource's update schema does NOT accept
    // connection_id (it would be silently dropped and the number never
    // rings our webhook). This write touches only connection_id; the SMS
    // binding (messaging_profile_id) is a different field and is never sent.
    const updated = await telnyxRequest<PhoneNumberUpdateResponse>(env, {
      method: "PATCH",
      path: `/v2/phone_numbers/${row.telnyx_phone_number_id}`,
      body: { connection_id: connectionId },
    });
    // Belt-and-braces against a silently-ignored field: never stamp the row
    // voice_enabled until Telnyx echoes the binding back — otherwise the flag
    // guard would permanently mask a dead voice path.
    if (updated.data?.connection_id !== connectionId) {
      throw new Error(
        `voice bind for number ${row.id} did not stick (Telnyx echoed connection_id=${updated.data?.connection_id ?? "null"})`,
      );
    }
  }

  const { error } = await db
    .from("phone_numbers")
    .update({ voice_connection_id: connectionId, voice_enabled: true })
    .eq("id", row.id)
    .eq("company_id", row.company_id);
  if (error) {
    throw new Error(`voice enable persist failed: ${error.message}`);
  }

  // #193: a number that just became voice-capable must carry the company's
  // calling settings — above all the effective caller ID (company name when
  // no explicit one is set). Best-effort: a failed catch-up never un-binds
  // voice; the next settings save re-pushes.
  try {
    await pushCallSettingsToNumber(
      env,
      db,
      row.company_id,
      row.telnyx_phone_number_id,
    );
  } catch (cause) {
    console.error(
      `call settings catch-up failed for number ${row.id}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  return {
    changed: true,
    connectionId,
    ...(alreadyBound ? { reason: "already_bound" as const } : {}),
  };
}

/**
 * Enable voice on every active number a company owns (idempotent per number).
 * Used by the settings path when the owner turns on the missed-call text-back
 * or sets a forward_to_cell — the number must be able to receive calls first.
 * Returns the per-number results. A number still provisioning is skipped (voice
 * is enabled once it is active, by the same path re-run).
 */
export async function enableVoiceForCompany(
  env: Env,
  db: SupabaseClient,
  companyId: string,
): Promise<VoiceEnableResult[]> {
  const { data, error } = await db
    .from("phone_numbers")
    .select(VOICE_NUMBER_COLUMNS)
    .eq("company_id", companyId)
    .eq("status", "active");
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);

  const results: VoiceEnableResult[] = [];
  for (const row of (data ?? []) as unknown as VoiceNumberRow[]) {
    // Only numbers Telnyx has actually purchased for us can be voice-bound.
    // (A hosted keep-your-number row has none — its voice stays on the owner's
    // carrier by design, so it is never voice-bound.)
    if (!row.telnyx_phone_number_id) continue;
    try {
      results.push(await enableVoiceOnNumber(env, db, row));
    } catch (cause) {
      // #134 review: one un-bindable number must never abort the company's
      // remaining numbers on this pass — the 15-min reconcile is the durable
      // per-number retry.
      console.error(
        `voice bind failed for number ${row.id}:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
  return results;
}

/**
 * #193: reduce a free-form business name to the carrier CNAM alphabet
 * (letters, digits, spaces; 15 chars max). Disallowed characters drop,
 * whitespace collapses, and the result is trimmed after the cut so a
 * mid-word truncation never leaves a trailing space. Returns null when
 * nothing usable survives (a name of pure punctuation).
 */
export function sanitizeCnamDisplayName(name: string): string | null {
  const cleaned = name
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * #193: the effective outbound caller ID — the platform-wide rule, applied
 * identically on the read path (GET /v1/company) and the outbound push
 * (Telnyx cnam_listing): the explicit override when set, else the company
 * name sanitized to the carrier alphabet.
 */
export function effectiveCnamDisplayName(company: {
  name: string | null | undefined;
  cnam_display_name: string | null | undefined;
}): string | null {
  if (
    typeof company.cnam_display_name === "string" &&
    company.cnam_display_name.length > 0
  ) {
    return company.cnam_display_name;
  }
  return typeof company.name === "string"
    ? sanitizeCnamDisplayName(company.name)
    : null;
}

/** D43: what the Calls settings sync pushes to every Telnyx number. */
export interface CallSettingsSync {
  /** 'off' | 'flag' | 'divert' — Telnyx-side both flag AND divert map to
   *  flag_calls (divert is OUR routing choice on the flagged verdict; Telnyx
   *  reject_calls would block the caller from even reaching voicemail). */
  callScreening?: "off" | "flag" | "divert";
  /** Inbound CNAM dip on/off (carrier-billed per lookup). */
  callerIdLookup?: boolean;
  /** #193: the RESOLVED effective outbound listing (callers pass it through
   *  effectiveCnamDisplayName first — "no explicit value" is never sent here
   *  as null anymore). null = nothing listable at all (a company name of
   *  pure punctuation), which disables the listing honestly. */
  cnamDisplayName?: string | null;
}

/** Build the Telnyx /voice sub-resource patch a CallSettingsSync implies. */
function buildVoicePatch(sync: CallSettingsSync): Record<string, unknown> {
  // ALL of screening, the inbound CNAM dip, AND the outbound CNAM listing
  // live on the /voice sub-resource — cnam_listing on the BASE phone-number
  // resource is silently ignored (verified against the live Telnyx API), so
  // the outbound display name never took effect there.
  const voicePatch: Record<string, unknown> = {};
  if (sync.callScreening !== undefined) {
    voicePatch.inbound_call_screening =
      sync.callScreening === "off" ? "disabled" : "flag_calls";
  }
  if (sync.callerIdLookup !== undefined) {
    voicePatch.caller_id_name_enabled = sync.callerIdLookup;
  }
  if (sync.cnamDisplayName !== undefined) {
    voicePatch.cnam_listing = sync.cnamDisplayName
      ? {
          cnam_listing_enabled: true,
          cnam_listing_details: sync.cnamDisplayName,
        }
      : { cnam_listing_enabled: false };
  }
  return voicePatch;
}

/**
 * D43: push the company's Calls settings (screening / CNAM dip / CNAM
 * listing) to every active, Telnyx-purchased number. Per-number best-effort
 * — one bad number never blocks the rest (the settings row is the source of
 * truth; a re-save or the next settings change re-pushes). Only the fields
 * present in `sync` are sent, so a greeting-only save touches nothing here.
 * Returns how many numbers the patch actually reached (#193: callers stamp
 * cnam_submitted_at only when a listing change really went out).
 */
export async function syncCallSettingsForCompany(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  sync: CallSettingsSync,
): Promise<{ pushed: number }> {
  const voicePatch = buildVoicePatch(sync);
  if (Object.keys(voicePatch).length === 0) return { pushed: 0 };

  const { data, error } = await db
    .from("phone_numbers")
    .select("id,telnyx_phone_number_id")
    .eq("company_id", companyId)
    .eq("status", "active");
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);

  let pushed = 0;
  for (const row of data ?? []) {
    const telnyxId = row.telnyx_phone_number_id as string | null;
    if (!telnyxId) continue; // hosted number — voice lives on the old carrier
    try {
      await telnyxRequest(env, {
        method: "PATCH",
        path: `/v2/phone_numbers/${telnyxId}/voice`,
        body: voicePatch,
      });
      pushed += 1;
    } catch (cause) {
      console.error(
        `call settings sync failed for number ${row.id as string}:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
  return { pushed };
}

/**
 * #193: catch-up push for a SINGLE freshly voice-bound number — reads the
 * company's saved calling settings and applies them (screening, the inbound
 * name dip, and the EFFECTIVE outbound caller ID, which defaults to the
 * company name). Without this, a number provisioned after the last settings
 * save carried no CNAM listing until an owner happened to re-save.
 */
export async function pushCallSettingsToNumber(
  env: Env,
  db: SupabaseClient,
  companyId: string,
  telnyxPhoneNumberId: string,
): Promise<void> {
  const { data, error } = await db
    .from("companies")
    .select("name,cnam_display_name,call_screening,caller_id_lookup")
    .eq("id", companyId)
    .limit(1);
  if (error) throw new Error(`company settings lookup failed: ${error.message}`);
  const company = data?.[0] as
    | {
        name: string | null;
        cnam_display_name: string | null;
        call_screening: "off" | "flag" | "divert" | null;
        caller_id_lookup: boolean | null;
      }
    | undefined;
  if (!company) return;

  const voicePatch = buildVoicePatch({
    ...(company.call_screening != null
      ? { callScreening: company.call_screening }
      : {}),
    ...(company.caller_id_lookup != null
      ? { callerIdLookup: company.caller_id_lookup }
      : {}),
    cnamDisplayName: effectiveCnamDisplayName(company),
  });
  await telnyxRequest(env, {
    method: "PATCH",
    path: `/v2/phone_numbers/${telnyxPhoneNumberId}/voice`,
    body: voicePatch,
  });
}

/**
 * §11 reconcile pass (15-minute cron): bind voice on any ACTIVE, un-bound
 * number of any LIVE-subscription workspace — calling is included on every
 * plan (#134/D42), so every paying workspace's numbers must be able to
 * receive calls. This closes the
 * gaps the trigger paths cannot cover: (a) the module/feature was enabled
 * while the number was still provisioning (the normal onboarding order —
 * the number activates later), (b) a number added/ported later to a company
 * that already had it on, and (c) the retry path for a trigger-time enable
 * that failed transiently (those enables are fire-and-forget). Idempotent
 * per number via enableVoiceOnNumber's guards.
 */
export async function reconcileVoiceEnablement(
  env: Env,
): Promise<{ checked: number; enabled: number }> {
  const db = getDb(env);
  const summary = { checked: 0, enabled: 0 };

  // #134/D42: calling is included on every plan — every workspace with a
  // LIVE subscription gets its numbers voice-bound. Ids only; small set.
  // NOTE: this filters the DB enum, not raw Stripe statuses — 'trialing'
  // never reaches the DB (plans.ts maps it to 'active'), and Postgres
  // rejects unknown enum values outright, which broke this cron every
  // 15 minutes (Sentry NODE-D).
  const { data: companies, error: companiesError } = await db
    .from("companies")
    .select("id")
    .in("subscription_status", ["active", "past_due"])
    .is("deleted_at", null);
  if (companiesError) {
    throw new Error(`companies lookup failed: ${companiesError.message}`);
  }
  const companyIds = (companies ?? []).map((row) => (row as { id: string }).id);
  if (companyIds.length === 0) return summary;

  const { data, error } = await db
    .from("phone_numbers")
    .select(VOICE_NUMBER_COLUMNS)
    .in("company_id", companyIds)
    .eq("status", "active")
    .eq("voice_enabled", false);
  if (error) throw new Error(`phone_numbers lookup failed: ${error.message}`);

  const failures: unknown[] = [];
  for (const row of (data ?? []) as unknown as VoiceNumberRow[]) {
    if (!row.telnyx_phone_number_id) continue; // hosted → never voice-bound
    summary.checked += 1;
    try {
      const result = await enableVoiceOnNumber(env, db, row);
      if (result.changed) summary.enabled += 1;
    } catch (cause) {
      // One number's failure never starves the rest; the cron re-runs in 15m.
      Sentry.captureException(cause);
      failures.push(cause);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `voice enablement reconcile failed for ${failures.length} number(s)`,
    );
  }
  return summary;
}
