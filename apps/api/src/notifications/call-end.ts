/**
 * Calls v3 (#170 §9.2) — the `kind:'call_end'` revocation push. Sent from the
 * CallSessionDO on every exit from `ringing` (answered / voicemail / missed)
 * so a member's tray/banner for a now-dead call is dismissed instead of
 * ringing a ghost (scenario 2's second act).
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

import { isFcmConfigured, sendFcm } from "./fcm";
import { sendWebPush } from "./webpush";

/** The capability string a v3 client declares to opt into `call_end`. */
export const CALL_END_CAP = "call_end";

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

export async function notifyCallEnd(
  env: Env,
  db: SupabaseClient,
  input: {
    companyId: string;
    userIds: string[];
    callSessionId: string;
    reason: "answered" | "voicemail" | "missed";
  },
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
  input: {
    companyId: string;
    userIds: string[];
    callSessionId: string;
    reason: "answered" | "voicemail" | "missed";
  },
): Promise<void> {
  if (input.userIds.length === 0) return;

  const payload = JSON.stringify({
    kind: "call_end",
    // The v3 client keys its cancel-by-tag on the session (§10.2).
    url: `/calls?call=${encodeURIComponent(input.callSessionId)}`,
    reason: input.reason,
    call_session_id: input.callSessionId,
  });

  // Web: caps-gated subscriptions only. `caps @> {call_end}` (Postgrest `cs`).
  const { data: subData, error: subError } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", input.userIds)
    .contains("caps", [CALL_END_CAP]);
  if (!subError) {
    const subscriptions = (subData ?? []) as SubscriptionRow[];
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const result = await sendWebPush(
            env,
            sub,
            payload,
            CALL_END_TTL_SECS,
            "high",
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
    .in("user_id", input.userIds)
    .contains("caps", [CALL_END_CAP])
    .order("created_at", { ascending: false })
    .limit(50);
  if (tokenError) return;
  const deviceTokens = (tokenData ?? []) as DeviceTokenRow[];
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
