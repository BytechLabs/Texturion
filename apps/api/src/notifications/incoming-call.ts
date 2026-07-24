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
 *
 * Calls v3 (#170 §5.5/§7.3, owned contract change): returns a per-user
 * delivery report so the CallSessionDO can prune provably-dead channels from
 * the ring audience. `unreachableUserIds` = requested members who, after this
 * fan-out, can no longer be woken: pref-disabled, or holding zero channels, or
 * every channel came back HARD-dead (gone). A member with even one channel
 * that merely soft-failed (transient) stays reachable — the ladder holds
 * ringback for them (§5.5: only provably-dead channels prune).
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

/**
 * How long a ringing-call push is worth delivering. Calls v3 (#170 §9.2): 45s,
 * up from 30 — it must OUTLIVE the 45s ring window, never undercut it.
 */
const CALL_PUSH_TTL_SECS = 45;

/**
 * Calls v3 (#170 §5.5): the per-user delivery report the DO prunes on. A user
 * is unreachable when every channel they hold is provably dead (or they hold
 * none / are pref-disabled) — the ladder then reaches voicemail seconds after
 * RING-START instead of holding 45s of ringback to a provably-empty room.
 */
export interface IncomingCallPushReport {
  unreachableUserIds: string[];
}

/** Mutable per-user channel accounting for the report. */
interface UserChannels {
  total: number;
  gone: number;
  liveOrSoft: number;
}

function bump(
  map: Map<string, UserChannels>,
  userId: string,
  field: "gone" | "liveOrSoft",
): void {
  const entry = map.get(userId) ?? { total: 0, gone: 0, liveOrSoft: 0 };
  entry.total += 1;
  entry[field] += 1;
  map.set(userId, entry);
}

/**
 * #142's actual outage signal, rescoped: a prune is routine lifecycle
 * (reinstall/rotation) and only LOGS — but a prune that leaves the member
 * with ZERO push channels means calls can no longer wake any of their devices,
 * and THAT earns a Sentry event. Best-effort: an error here must never touch
 * the live ring.
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
): Promise<IncomingCallPushReport> {
  // Best-effort contract (#140 awaits this in the ring path): a thrown DB/network
  // error here must NEVER break the live call. Swallow-but-report at the top so
  // the caller can safely await without a try/catch of its own. On an error we
  // cannot prove any channel dead → report NO one unreachable (the DO holds the
  // ladder to the alarm rather than pruning on a guess — §5.5).
  try {
    return await deliverIncomingCallPush(env, db, input);
  } catch (cause) {
    Sentry.captureException(cause);
    return { unreachableUserIds: [] };
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
): Promise<IncomingCallPushReport> {
  if (input.userIds.length === 0) return { unreachableUserIds: [] };

  // #146: honor each member's push_enabled preference (default ON when there's
  // no prefs row), scoped to this company — mirroring notifyMissedCall.
  const { data: prefRows, error: prefError } = await db
    .from("notification_prefs")
    .select("user_id,push_enabled")
    .eq("company_id", input.companyId)
    .in("user_id", input.userIds);
  if (prefError) return { unreachableUserIds: [] }; // best-effort — never throw
  const pushEnabled = new Map(
    (prefRows ?? []).map((row) => [
      (row as { user_id: string }).user_id,
      (row as { push_enabled: boolean | null }).push_enabled,
    ]),
  );
  const pushUserIds = input.userIds.filter(
    (userId) => pushEnabled.get(userId) ?? true,
  );
  // Pref-disabled members are unreachable by construction (the same filter the
  // audience computation applies — §5.5 review R2-I1).
  const prefSkipped = input.userIds.filter(
    (userId) => !(pushEnabled.get(userId) ?? true),
  );
  if (pushUserIds.length === 0) {
    return { unreachableUserIds: [...input.userIds] };
  }

  const channels = new Map<string, UserChannels>();

  const { data, error } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", pushUserIds)
    // #30 defensive bound (mirrors inbound.ts): each user is capped at 10 live
    // subscriptions, but a bad table state must never unbound the ring fan-out —
    // newest 50 across the audience is far above any legitimate team's devices.
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { unreachableUserIds: [] }; // best-effort — never throw
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
          bump(channels, sub.user_id, "gone");
          // Expected lifecycle (browser reinstall/rotation) — a log line, NOT
          // a Sentry event. #142's real signal is handled below: a prune that
          // leaves the user with ZERO push channels escalates.
          console.log(
            `incoming-call push: pruned dead subscription (${endpointHost(sub.endpoint)}, HTTP ${result.status})`,
          );
          await warnIfUnreachable(db, sub.user_id);
        } else if (!result.ok) {
          bump(channels, sub.user_id, "liveOrSoft"); // transient — still an avenue
          // #142/#147: surface WHICH status came back (VAPID 403, malformed 400,
          // throttled 429, push-service 5xx) AND the service's own error text —
          // the lead for diagnosing a silent wake outage. Best-effort, no throw.
          const detail = result.errorBody ? ` — ${result.errorBody}` : "";
          Sentry.captureMessage(
            `incoming-call push: delivery failed (${endpointHost(sub.endpoint)}, HTTP ${result.status})${detail}`,
            "warning",
          );
        } else {
          bump(channels, sub.user_id, "liveOrSoft");
        }
      } catch (cause) {
        // A network drop or local crypto failure — observable but never fatal
        // to the live call. Push weather must never break a ring. A thrown send
        // is transient, not proof-dead → counts as an avenue.
        bump(channels, sub.user_id, "liveOrSoft");
        Sentry.captureException(cause);
      }
    }),
  );

  // NATIVE DEVICE PUSH (#151): the same wake payload to every registered
  // Android/iOS device of the ring targets — FCM HIGH priority + the same TTL,
  // so a dozing phone actually wakes for the ring window. Same best-effort
  // contract as the Web Push branch above. Skipped with one log line until
  // Firebase is provisioned (optional secret, deploys green).
  if (!isFcmConfigured(env)) {
    console.log(
      "fcm: FCM_SERVICE_ACCOUNT_JSON unset — native device push skipped",
    );
    return { unreachableUserIds: computeUnreachable(pushUserIds, prefSkipped, channels) };
  }
  const { data: tokenRows, error: tokenError } = await db
    .from("device_push_tokens")
    .select("id,user_id,platform,token")
    .in("user_id", pushUserIds)
    // #30-style defensive bound: newest 50 across the audience.
    .order("created_at", { ascending: false })
    .limit(50);
  if (tokenError) return { unreachableUserIds: [] }; // best-effort — never throw
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
          bump(channels, device.user_id, "gone");
          console.log(
            `incoming-call push: pruned dead device token (${device.platform}, HTTP ${result.status})`,
          );
          await warnIfUnreachable(db, device.user_id);
        } else if (!result.ok) {
          bump(channels, device.user_id, "liveOrSoft");
          const detail = result.errorBody ? ` — ${result.errorBody}` : "";
          Sentry.captureMessage(
            `incoming-call push: native delivery failed (${device.platform}, HTTP ${result.status})${detail}`,
            "warning",
          );
        } else {
          bump(channels, device.user_id, "liveOrSoft");
        }
      } catch (cause) {
        // OAuth weather / network drop — observable but never fatal to the
        // live call. A thrown send is transient → counts as an avenue.
        bump(channels, device.user_id, "liveOrSoft");
        Sentry.captureException(cause);
      }
    }),
  );

  return { unreachableUserIds: computeUnreachable(pushUserIds, prefSkipped, channels) };
}

/**
 * A member is unreachable when every channel they held is provably dead (or
 * they held none), plus every pref-disabled member. A member with ≥1 channel
 * that merely soft-failed stays reachable (only provably-dead channels prune —
 * §5.5).
 */
function computeUnreachable(
  pushUserIds: string[],
  prefSkipped: string[],
  channels: Map<string, UserChannels>,
): string[] {
  const unreachable = new Set(prefSkipped);
  for (const userId of pushUserIds) {
    const entry = channels.get(userId);
    if (!entry || entry.total === 0 || entry.liveOrSoft === 0) {
      unreachable.add(userId);
    }
  }
  return [...unreachable];
}
