/**
 * Calls v3 (#170 §9.2) — the `kind:'call_end'` revocation push. Sent from the
 * CallSessionDO on every exit from `ringing` (answered / voicemail / missed)
 * so a member's tray/banner for a now-dead call is dismissed instead of
 * ringing a ghost (scenario 2's second act).
 *
 * IT CARRIES THE OUTCOME, and the web client renders it (#265). Web Push
 * subscriptions are created `userVisibleOnly: true`, and browsers hold us to
 * that: Firefox decrements a per-subscription quota on every push that
 * displays nothing and UNSUBSCRIBES the endpoint at zero — after ~16 calls the
 * member silently loses rings, texts and missed-call alerts with no way to
 * know — while Chrome eventually shows its own "site updated in the
 * background" notice, which is the very ghost this push exists to prevent. So
 * a call_end REPLACES the ring in the tray with what happened to the call
 * rather than leaving a hole. Android has no such contract and still cancels
 * silently (its FCM sends are data-only, §9.2).
 *
 * DELIVERY IS CAPABILITY-GATED (review R2-B1 — the fleet-ghost gate): a pre-v3
 * client would parse `call_end` as a generic notification and render a stray
 * "new notification" on every call, fleet-wide, while the ring alert survives
 * (Android data-only FCM carries no collapse key, §9.2; web sw.js renders
 * every push). So this sends ONLY to `push_subscriptions` / `device_push_tokens`
 * rows whose `caps` array declares `"call_end"` — written by the v3 client at
 * (re)registration. Until a client updates, its row lacks the cap and receives
 * nothing.
 *
 * Best-effort like all push: a failure here must never disturb the terminal
 * path, so it never throws. No pruning here — the ring fan-out (incoming-call)
 * owns channel liveness; a call_end to a dead channel is a harmless no-op.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";

import { newestPerUser } from "./deliver";
import { isFcmConfigured, sendFcm } from "./fcm";
import { sendWebPush } from "./webpush";

/** The capability string a v3 client declares to opt into `call_end`. */
export const CALL_END_CAP = "call_end";

/** Per-recipient device bound (#267): never a single ceiling across the crew. */
const MAX_TARGETS_PER_USER = 10;

/**
 * What the tray says once the ring is over. It replaces the ring in place, so
 * it answers the only question the member has: did anyone get that?
 */
export function callEndAlert(
  reason: "answered" | "voicemail" | "missed",
  caller: string | null,
  answeredBy: string | null,
): { title: string; body: string } {
  const who = caller?.trim() || "Someone";
  if (reason === "answered") {
    return {
      title: "Call answered",
      body: answeredBy?.trim()
        ? `${answeredBy.trim()} picked it up.`
        : "A teammate picked it up.",
    };
  }
  if (reason === "voicemail") {
    return { title: "New voicemail", body: `${who} left a message.` };
  }
  return { title: "Missed call", body: `${who} called and nobody picked up.` };
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface DeviceTokenRow {
  id: string;
  user_id: string;
  platform: "android" | "ios";
  token: string;
}

/** A call_end is only worth delivering while the tray entry could still be up. */
const CALL_END_TTL_SECS = 45;

export interface CallEndInput {
  companyId: string;
  userIds: string[];
  callSessionId: string;
  reason: "answered" | "voicemail" | "missed";
  /** The far party, for the outcome copy. */
  caller?: string | null;
  /** Whoever took the call — named in the `answered` card. */
  answeredByUserId?: string | null;
}

export async function notifyCallEnd(
  env: Env,
  db: SupabaseClient,
  input: CallEndInput,
): Promise<void> {
  try {
    await deliverCallEnd(env, db, input);
  } catch (cause) {
    Sentry.captureException(cause);
  }
}

async function deliverCallEnd(
  env: Env,
  db: SupabaseClient,
  input: CallEndInput,
): Promise<void> {
  if (input.userIds.length === 0) return;

  // A member who turned push OFF still received these, because the audience is
  // built from dial targets — gated on SIP credentials and number access, not
  // on the preference. Honor it here, exactly as the ring fan-out does (#146).
  const { data: prefRows, error: prefError } = await db
    .from("notification_prefs")
    .select("user_id,push_enabled")
    .eq("company_id", input.companyId)
    .in("user_id", input.userIds);
  if (prefError) return; // best-effort — a prefs blip must not disturb a call
  const pushEnabled = new Map(
    (prefRows ?? []).map((row) => [
      (row as { user_id: string }).user_id,
      (row as { push_enabled: boolean | null }).push_enabled,
    ]),
  );
  const userIds = input.userIds.filter(
    (userId) => pushEnabled.get(userId) ?? true,
  );
  if (userIds.length === 0) return;

  let answeredBy: string | null = null;
  if (input.reason === "answered" && input.answeredByUserId) {
    const { data } = await db
      .from("profiles")
      .select("display_name")
      .eq("user_id", input.answeredByUserId)
      .limit(1);
    answeredBy =
      ((data ?? [])[0] as { display_name: string | null } | undefined)
        ?.display_name ?? null;
  }

  const alert = callEndAlert(input.reason, input.caller ?? null, answeredBy);
  const payload = JSON.stringify({
    kind: "call_end",
    // The v3 client keys its cancel-by-tag on the session (§10.2).
    url: `/calls?call=${encodeURIComponent(input.callSessionId)}`,
    reason: input.reason,
    call_session_id: input.callSessionId,
    ...alert,
  });

  const ceiling = userIds.length * MAX_TARGETS_PER_USER;

  // Web: caps-gated subscriptions only. `caps @> {call_end}` (Postgrest `cs`).
  const { data: subData, error: subError } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", userIds)
    .contains("caps", [CALL_END_CAP])
    // Ten devices PER recipient (#267) — a single ceiling across the audience
    // always cut the same longest-tenured members.
    .order("created_at", { ascending: false })
    .limit(ceiling);
  if (!subError) {
    const subscriptions = newestPerUser(
      (subData ?? []) as SubscriptionRow[],
      MAX_TARGETS_PER_USER,
    );
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const result = await sendWebPush(
            env,
            sub,
            payload,
            CALL_END_TTL_SECS,
            "high",
            // The ring's own collapse identity: the outcome card REPLACES the
            // ring rather than landing beside it.
            `call:${input.callSessionId}`,
          );
          if (result.gone) {
            await db.from("push_subscriptions").delete().eq("id", sub.id);
          }
        } catch (cause) {
          Sentry.captureException(cause);
        }
      }),
    );
  }

  // Native: caps-gated device tokens only.
  if (!isFcmConfigured(env)) return;
  const { data: tokenData, error: tokenError } = await db
    .from("device_push_tokens")
    .select("id,user_id,platform,token")
    .in("user_id", userIds)
    .contains("caps", [CALL_END_CAP])
    .order("created_at", { ascending: false })
    .limit(ceiling);
  if (tokenError) return;
  const deviceTokens = newestPerUser(
    (tokenData ?? []) as DeviceTokenRow[],
    MAX_TARGETS_PER_USER,
  );
  await Promise.all(
    deviceTokens.map(async (device) => {
      try {
        const result = await sendFcm(
          env,
          device,
          payload,
          CALL_END_TTL_SECS,
          "high",
          `call:${input.callSessionId}`,
        );
        if (result.gone) {
          await db.from("device_push_tokens").delete().eq("id", device.id);
        }
      } catch (cause) {
        Sentry.captureException(cause);
      }
    }),
  );
}
