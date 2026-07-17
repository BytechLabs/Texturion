/**
 * Push-to-wake (#135): alert every ringing member on their PHONE the moment an
 * inbound call arrives, so a mobile browser tab that's been suspended (and so
 * can't render the in-app ring) still surfaces the call. High urgency + a short
 * TTL — the call is only live for the ring window, so a late-delivered push is
 * noise, not a ring.
 *
 * Best-effort by contract: a push failure (dead subscription, push-service
 * weather) must NEVER disturb the ring / voicemail path, so this never throws.
 * Dead subscriptions (404/410) are pruned opportunistically. Every non-OK
 * outcome and every prune is reported to Sentry (host + status only) so a
 * wake outage is diagnosable (#142). Members who disabled push in settings are
 * skipped, matching the missed-call / inbound-message paths (#146).
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";

import { isFcmConfigured, sendFcm } from "./fcm";
import { sendWebPush } from "./webpush";

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

/** How long a ringing-call push is worth delivering (≈ the ring window). */
const CALL_PUSH_TTL_SECS = 30;

/**
 * #142's actual outage signal, rescoped: a prune is routine lifecycle
 * (reinstall/rotation) and only LOGS — but a prune that leaves the member
 * with ZERO push channels (no web subscription, no device token) means calls
 * can no longer wake any of their devices, and THAT earns a Sentry event.
 * Best-effort: an error here must never touch the live ring.
 */
async function warnIfUnreachable(
  db: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    const [subs, tokens] = await Promise.all([
      db.from("push_subscriptions").select("id").eq("user_id", userId).limit(1),
      db.from("device_push_tokens").select("id").eq("user_id", userId).limit(1),
    ]);
    if (subs.error || tokens.error) return;
    if ((subs.data ?? []).length === 0 && (tokens.data ?? []).length === 0) {
      Sentry.captureMessage(
        `incoming-call push: member ${userId} now has NO push channels — ring-when-closed is dead for them until a device re-registers`,
        "warning",
      );
    }
  } catch {
    // Counting is diagnostics — never let it interfere with the ring.
  }
}

/** Host only — the full endpoint carries a per-device push token we must never
 *  log or send to Sentry. */
function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}

export async function notifyIncomingCall(
  env: Env,
  db: SupabaseClient,
  input: {
    companyId: string;
    userIds: string[];
    caller: string | null;
    callSessionId: string;
  },
): Promise<void> {
  // Best-effort contract (#140 awaits this in the ring path): a thrown DB/network
  // error here must NEVER break the live call. Swallow-but-report at the top so
  // the caller can safely await without a try/catch of its own.
  try {
    await deliverIncomingCallPush(env, db, input);
  } catch (cause) {
    Sentry.captureException(cause);
  }
}

async function deliverIncomingCallPush(
  env: Env,
  db: SupabaseClient,
  input: {
    companyId: string;
    userIds: string[];
    caller: string | null;
    callSessionId: string;
  },
): Promise<void> {
  if (input.userIds.length === 0) return;

  // #146: honor each member's push_enabled preference (default ON when there's
  // no prefs row), scoped to this company — mirroring notifyMissedCall.
  const { data: prefRows, error: prefError } = await db
    .from("notification_prefs")
    .select("user_id,push_enabled")
    .eq("company_id", input.companyId)
    .in("user_id", input.userIds);
  if (prefError) return; // best-effort — never throw into the ring path
  const pushEnabled = new Map(
    (prefRows ?? []).map((row) => [
      (row as { user_id: string }).user_id,
      (row as { push_enabled: boolean | null }).push_enabled,
    ]),
  );
  const pushUserIds = input.userIds.filter(
    (userId) => pushEnabled.get(userId) ?? true,
  );
  if (pushUserIds.length === 0) return;

  const { data, error } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", pushUserIds);
  if (error) return; // best-effort — never throw
  const subscriptions = (data ?? []) as SubscriptionRow[];

  const payload = JSON.stringify({
    kind: "call", // the service worker renders this as an urgent call alert
    title: "Incoming call",
    body: input.caller ?? "Someone is calling your business number",
    // Land on /calls carrying the session — the app re-rings this member's
    // now-awake browser for it (push-to-wake part 2).
    url: `/calls?call=${encodeURIComponent(input.callSessionId)}`,
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        const result = await sendWebPush(
          env,
          sub,
          payload,
          CALL_PUSH_TTL_SECS,
          "high",
        );
        if (result.gone) {
          await db.from("push_subscriptions").delete().eq("id", sub.id);
          // Expected lifecycle (browser reinstall/rotation) — a log line, NOT
          // a Sentry event. #142's real signal is handled below: a prune that
          // leaves the user with ZERO push channels escalates.
          console.log(
            `incoming-call push: pruned dead subscription (${endpointHost(sub.endpoint)}, HTTP ${result.status})`,
          );
          await warnIfUnreachable(db, sub.user_id);
        } else if (!result.ok) {
          // #142/#147: surface WHICH status came back (VAPID 403, malformed 400,
          // throttled 429, push-service 5xx) AND the service's own error text —
          // the lead for diagnosing a silent wake outage. Best-effort, no throw.
          const detail = result.errorBody ? ` — ${result.errorBody}` : "";
          Sentry.captureMessage(
            `incoming-call push: delivery failed (${endpointHost(sub.endpoint)}, HTTP ${result.status})${detail}`,
            "warning",
          );
        }
      } catch (cause) {
        // A network drop or local crypto failure — observable but never fatal
        // to the live call. Push weather must never break a ring.
        Sentry.captureException(cause);
      }
    }),
  );

  // NATIVE DEVICE PUSH (#151): the same wake payload to every registered
  // Android/iOS device of the ring targets — FCM HIGH priority + the same 30s
  // TTL, so a dozing phone actually wakes for the ring window. Same
  // best-effort contract as the Web Push branch above. Skipped with one log
  // line until Firebase is provisioned (optional secret, deploys green).
  if (!isFcmConfigured(env)) {
    console.log(
      "fcm: FCM_SERVICE_ACCOUNT_JSON unset — native device push skipped",
    );
    return;
  }
  const { data: tokenRows, error: tokenError } = await db
    .from("device_push_tokens")
    .select("id,user_id,platform,token")
    .in("user_id", pushUserIds)
    // #30-style defensive bound: newest 50 across the audience.
    .order("created_at", { ascending: false })
    .limit(50);
  if (tokenError) return; // best-effort — never throw into the ring path
  const deviceTokens = (tokenRows ?? []) as DeviceTokenRow[];

  await Promise.all(
    deviceTokens.map(async (device) => {
      try {
        const result = await sendFcm(
          env,
          device,
          payload,
          CALL_PUSH_TTL_SECS,
          "high",
          // #162/#149 iOS coalescing: per call SESSION — repeats for one call
          // replace each other; two concurrent calls stay two alerts.
          `call:${input.callSessionId}`,
        );
        if (result.gone) {
          // UNREGISTERED token (app uninstalled / rotated): expected
          // lifecycle — drop the row with a log line, NOT a Sentry event.
          // Platform + status only; the token itself is a per-device
          // credential we never log. #142's real signal escalates below.
          await db.from("device_push_tokens").delete().eq("id", device.id);
          console.log(
            `incoming-call push: pruned dead device token (${device.platform}, HTTP ${result.status})`,
          );
          await warnIfUnreachable(db, device.user_id);
        } else if (!result.ok) {
          const detail = result.errorBody ? ` — ${result.errorBody}` : "";
          Sentry.captureMessage(
            `incoming-call push: native delivery failed (${device.platform}, HTTP ${result.status})${detail}`,
            "warning",
          );
        }
      } catch (cause) {
        // OAuth weather / network drop — observable but never fatal to the
        // live call.
        Sentry.captureException(cause);
      }
    }),
  );
}
