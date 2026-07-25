/**
 * The push fan-out shared by the notification pipelines that treat a delivery
 * failure as a webhook-level failure: one Web Push per stored subscription and
 * one FCM send per registered device, of every push-enabled recipient, with the
 * dead-row prune both services require.
 *
 * Callers own the audience, the payload and what happens to the failures; this
 * owns the mechanics, which are the parts that must not drift between
 * pipelines. A subscription pruned in one place and kept in another is how a
 * team ends up with a member nothing can reach.
 *
 * `notifications/incoming-call.ts` and `notifications/call-end.ts` deliberately
 * keep their own fan-out. Both are best-effort (push weather must never break a
 * live call, so nothing they do throws), both filter on the capability column,
 * and incoming-call additionally tallies per-user channel health to decide who
 * the ring could not reach. Folding those in would mean an option for every
 * difference, which is the shape this file exists to avoid.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { isFcmConfigured, sendFcm } from "./fcm";
import { sendWebPush } from "./webpush";

/**
 * Defensive bound on both queries. POST /v1/push-subscriptions caps each user
 * at 10 live rows, but a bad table state must never leave a fan-out unbounded:
 * the newest 50 across the audience is far above any legitimate team's devices.
 */
const MAX_TARGETS = 50;

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

export interface PushDelivery {
  /** Push-enabled recipients. Nothing is sent for an empty list. */
  userIds: string[];
  /** Web Push body, as the apps/web service worker expects it. */
  webPayload: string;
  /**
   * FCM body. Defaults to the Web Push one; set it only where the native
   * clients need something the service worker must not see, such as the
   * structural `kind` discriminator that picks an Android channel.
   */
  nativePayload?: string;
  /**
   * apns-collapse-id / FCM collapse key: repeats about the same subject
   * REPLACE the pending alert instead of stacking. Must match what the clients
   * coalesce on.
   */
  collapseKey: string;
  /**
   * Every failure lands here rather than throwing, so one dead device cannot
   * stop the rest of the fan-out. The caller decides what a non-empty list
   * means.
   */
  failures: unknown[];
}

export async function deliverPush(
  env: Env,
  db: SupabaseClient,
  delivery: PushDelivery,
): Promise<void> {
  if (delivery.userIds.length === 0) return;

  const { data: subData, error: subError } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", delivery.userIds)
    .order("created_at", { ascending: false })
    .limit(MAX_TARGETS);
  if (subError) {
    throw new Error(`push subscriptions lookup failed: ${subError.message}`);
  }

  for (const subscription of (subData ?? []) as SubscriptionRow[]) {
    try {
      const result = await sendWebPush(env, subscription, delivery.webPayload);
      if (result.gone) {
        // Permanently dead endpoint (unsubscribed/expired): drop the row.
        const { error } = await db
          .from("push_subscriptions")
          .delete()
          .eq("id", subscription.id);
        if (error) {
          throw new Error(
            `dead push subscription cleanup failed: ${error.message}`,
          );
        }
      } else if (!result.ok) {
        throw new Error(
          `push delivery failed with HTTP ${result.status} for subscription ${subscription.id}` +
            (result.errorBody ? ` — ${result.errorBody}` : ""),
        );
      }
    } catch (cause) {
      delivery.failures.push(cause);
    }
  }

  // Native device push: skipped with one log line until Firebase is
  // provisioned (the secret is optional so deploys stay green).
  if (!isFcmConfigured(env)) {
    console.log(
      "fcm: FCM_SERVICE_ACCOUNT_JSON unset — native device push skipped",
    );
    return;
  }

  const { data: tokenData, error: tokenError } = await db
    .from("device_push_tokens")
    .select("id,user_id,platform,token")
    .in("user_id", delivery.userIds)
    .order("created_at", { ascending: false })
    .limit(MAX_TARGETS);
  if (tokenError) {
    throw new Error(`device push tokens lookup failed: ${tokenError.message}`);
  }

  const nativePayload = delivery.nativePayload ?? delivery.webPayload;
  for (const device of (tokenData ?? []) as DeviceTokenRow[]) {
    try {
      // TTL and urgency ride the sender defaults: these alerts are worth
      // delivering late, unlike a ring.
      const result = await sendFcm(
        env,
        device,
        nativePayload,
        undefined,
        undefined,
        delivery.collapseKey,
      );
      if (result.gone) {
        // FCM says UNREGISTERED (app uninstalled / token rotated): drop the
        // row, mirroring the Web Push 404/410 prune.
        const { error } = await db
          .from("device_push_tokens")
          .delete()
          .eq("id", device.id);
        if (error) {
          throw new Error(
            `dead device push token cleanup failed: ${error.message}`,
          );
        }
      } else if (!result.ok) {
        throw new Error(
          `native push delivery failed with HTTP ${result.status} for device token ${device.id}` +
            (result.errorBody ? ` — ${result.errorBody}` : ""),
        );
      }
    } catch (cause) {
      delivery.failures.push(cause);
    }
  }
}
