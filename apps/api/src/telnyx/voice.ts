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
    results.push(await enableVoiceOnNumber(env, db, row));
  }
  return results;
}

/**
 * §11 reconcile pass (15-minute cron): bind voice on any ACTIVE, un-bound
 * number whose company has the voice feature on — the Calling MODULE
 * (#133: buying it must make the numbers callable; the founder bought it,
 * called their number, and the carrier said "unavailable" because nothing
 * ever bound the voice connection), or MCTB/forward_to_cell for legacy
 * (grandfathered) configurations that predate module rows. This closes the
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

  // Companies with the voice feature on. Small sets; ids only.
  const [companiesResult, modulesResult] = await Promise.all([
    db
      .from("companies")
      .select("id")
      .or("mctb_enabled.eq.true,forward_to_cell.not.is.null"),
    db
      .from("company_modules")
      .select("company_id")
      .eq("module", "voice")
      .is("disabled_at", null),
  ]);
  if (companiesResult.error) {
    throw new Error(`companies lookup failed: ${companiesResult.error.message}`);
  }
  if (modulesResult.error) {
    throw new Error(
      `company_modules lookup failed: ${modulesResult.error.message}`,
    );
  }
  const companyIds = [
    ...new Set([
      ...(companiesResult.data ?? []).map((row) => (row as { id: string }).id),
      ...(modulesResult.data ?? []).map(
        (row) => (row as { company_id: string }).company_id,
      ),
    ]),
  ];
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
