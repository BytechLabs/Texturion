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
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { isFcmConfigured, sendFcm } from "./fcm";
import { resolveHighPriority, type HighPriorityRequest } from "./high-priority";
import { sendWebPush } from "./webpush";

/**
 * Defensive bound, applied PER RECIPIENT rather than across the audience.
 *
 * A single ceiling over the whole fan-out looks safe and is not: with a
 * 10-row-per-user cap (MAX_PUSH_SUBSCRIPTIONS_PER_USER), five heavy users fill
 * a 50-row window, and because the sort is `created_at DESC` the rows that fall
 * off are always the same longest-tenured members — a permanent, silent
 * blackout for a fixed slice of the crew instead of an occasional miss. The
 * bound belongs where the real limit is: each person's own devices.
 */
const MAX_TARGETS_PER_USER = 10;

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
 * The notification body both clients parse. `tag` is added here, never by a
 * caller — see `PushDelivery.collapseKey`.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** Absolute deep link on APP_ORIGIN. */
  url: string;
  /** Structural discriminator the native clients branch on (channel routing). */
  kind?: string;
  /**
   * #244: the alert this notification is about, when it is one somebody can
   * claim. Its presence is what lets a client offer "I have this" instead of
   * only a link into the thread — without it the notification is quieter but
   * still unanswerable, which is half the feature.
   */
  alert_id?: string;
}

/**
 * #430 — whose words are in this payload.
 *
 * REQUIRED, and that is the whole design. Six push sites exist and three of
 * them carry something a person typed: the customer's message, a teammate's
 * note, and a task title (which per the personal-data inventory routinely
 * holds a job address). Nothing in the type system distinguished those from
 * "Carrier approval came through", so a seventh site would have inherited
 * whatever the author happened to copy.
 *
 * Declaring it at the call site means a new push cannot be written without
 * someone deciding whether a homeowner's words are about to appear on a lock
 * screen in another homeowner's kitchen. The same move `highPriority` makes
 * for a rationed resource, for a resource that cannot be un-spent.
 */
export type PushContent =
  /**
   * Every word is ours. Nothing to withhold, and the workspace setting does
   * not apply — suppressing "Carrier approval came through" would protect
   * nobody and cost the customer the alert.
   */
  | { written: "us" }
  /**
   * The payload carries words a PERSON typed. Checked against the workspace's
   * `push_include_content` before it leaves; when that is off, `withheld`
   * replaces the fields named in it.
   */
  | {
      written: "people";
      companyId: string;
      /**
       * What to say instead. Whatever is present replaces the same field on
       * the payload; the rest rides unchanged, which is why the contact name
       * survives — knowing WHO is most of the triage value and carries far
       * less of the exposure than knowing what they said.
       */
      withheld: Partial<Pick<PushPayload, "title" | "body">>;
    };

export interface PushDelivery {
  /** Push-enabled recipients. Nothing is sent for an empty list. */
  userIds: string[];
  /**
   * #430: whose words these are. See {@link PushContent} — required so that a
   * new push site cannot be added without answering the question.
   */
  content: PushContent;
  /** Notification content, as the apps/web service worker expects it. */
  web: PushPayload;
  /**
   * Native content. Defaults to the web one; set it only where the native
   * clients need something the service worker must not see, such as the
   * structural `kind` discriminator that picks an Android channel.
   */
  native?: PushPayload;
  /**
   * The one coalescing identity for this alert: repeats about the same subject
   * REPLACE the pending notification instead of stacking, and two DIFFERENT
   * subjects never replace each other.
   *
   * It reaches all three clients from here, which is the point — every client
   * deriving its own tag is how `mention:<messageId>` silently degraded to
   * "per conversation" on web and Android and let a customer's text erase a
   * teammate's direct ask. It rides as `tag` in the payload (web sw.js and the
   * Android client coalesce on it), as `apns-collapse-id` (iOS can't retag a
   * remote alert, so coalescing is server-side), as the FCM collapse key, and
   * as the Web Push `Topic` header for messages still queued at the service.
   */
  collapseKey: string;
  /**
   * #414: present asks for "high", which wakes a phone in Doze (FCM HIGH /
   * APNs priority 10); absent is power-considerate and can be deferred for
   * hours. Ordinary alerts are worth delivering late — an emergency is not.
   *
   * #452: it carries a company and a reason rather than a bare `"high"`,
   * because high priority is a rationed resource and every request for it has
   * to be attributable. Typing it this way is the point: an unmetered call on
   * that resource is not expressible.
   */
  highPriority?: HighPriorityRequest;
  /**
   * Every failure lands here rather than throwing, so one dead device cannot
   * stop the rest of the fan-out. The caller decides what a non-empty list
   * means.
   */
  failures: unknown[];
}

/**
 * Newest `perUser` rows for each recipient, from a `created_at DESC` result.
 * The input order is already newest-first, so the first N seen per user ARE
 * their newest N — no re-sorting, and every recipient keeps at least one
 * device however many the noisiest member has registered.
 */
export function newestPerUser<T extends { user_id: string }>(
  rows: T[],
  perUser: number,
): T[] {
  const counts = new Map<string, number>();
  const kept: T[] = [];
  for (const row of rows) {
    const seen = counts.get(row.user_id) ?? 0;
    if (seen >= perUser) continue;
    counts.set(row.user_id, seen + 1);
    kept.push(row);
  }
  return kept;
}

/**
 * A fan-out query that came back full may have been cut short by the ceiling,
 * which would drop somebody's alert with nothing to show for it. Say so: a
 * silent blackout that nobody can see is the failure mode this whole bound
 * exists to avoid.
 */
function warnIfTruncated(table: string, rowCount: number, ceiling: number): void {
  if (rowCount < ceiling) return;
  const message =
    `push fan-out: ${table} returned the full ${ceiling}-row ceiling — ` +
    `some recipients may not have been reached`;
  console.warn(message);
  Sentry.captureMessage(message, "warning");
}

/**
 * The workspace's answer, read fresh every time (#430).
 *
 * DELIBERATELY UNCACHED. An owner who turns this off has just decided that
 * customer content must stop leaving, and a TTL would mean it kept leaving for
 * the length of the TTL — which is the one window where somebody is watching.
 * The cost is a single primary-key read, and only on the sites that carry a
 * person's words.
 *
 * A lookup FAILURE withholds. Every other fallback in this codebase fails to
 * the permissive default because the alternative is a dead product; here the
 * permissive default publishes a third party's words to a lock screen, and the
 * alert still arrives carrying the contact's name. Losing the snippet is a
 * degraded notification. Sending it against the workspace's instruction is the
 * thing this feature exists to prevent.
 */
async function withheldFields(
  db: SupabaseClient,
  content: PushContent,
): Promise<Partial<PushPayload>> {
  if (content.written === "us") return {};

  const { data, error } = await db
    .from("companies")
    .select("push_include_content")
    .eq("id", content.companyId)
    .maybeSingle();
  if (error) {
    console.error(`push content setting lookup failed: ${error.message}`);
    return content.withheld;
  }
  const include = (data as { push_include_content?: boolean } | null)
    ?.push_include_content;
  return include === false ? content.withheld : {};
}

export async function deliverPush(
  env: Env,
  db: SupabaseClient,
  delivery: PushDelivery,
): Promise<void> {
  if (delivery.userIds.length === 0) return;

  // #430: withhold BEFORE serializing, so the content never exists in a
  // payload at all rather than being hidden by a client that might not.
  const withheld = await withheldFields(db, delivery.content);
  const web = { ...delivery.web, ...withheld };
  const native = { ...(delivery.native ?? delivery.web), ...withheld };

  // The collapse key IS the tag: one identity, serialized once, so no client
  // has to invent its own (#266).
  const webPayload = JSON.stringify({ ...web, tag: delivery.collapseKey });
  const nativePayload = JSON.stringify({
    ...native,
    tag: delivery.collapseKey,
  });
  const ceiling = delivery.userIds.length * MAX_TARGETS_PER_USER;

  const { data: subData, error: subError } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", delivery.userIds)
    .order("created_at", { ascending: false })
    .limit(ceiling);
  if (subError) {
    throw new Error(`push subscriptions lookup failed: ${subError.message}`);
  }
  const subscriptionRows = (subData ?? []) as SubscriptionRow[];
  warnIfTruncated("push_subscriptions", subscriptionRows.length, ceiling);

  for (const subscription of newestPerUser(
    subscriptionRows,
    MAX_TARGETS_PER_USER,
  )) {
    try {
      // Web Push urgency is NOT metered (#452): no push service rations it,
      // so degrading it would save nothing and cost a wake. The meter below
      // covers the native sends, which are the ones Google and Apple count.
      const result = await sendWebPush(
        env,
        subscription,
        webPayload,
        undefined,
        delivery.highPriority ? "high" : "normal",
        delivery.collapseKey,
      );
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
    .limit(ceiling);
  if (tokenError) {
    throw new Error(`device push tokens lookup failed: ${tokenError.message}`);
  }
  const tokenRows = (tokenData ?? []) as DeviceTokenRow[];
  warnIfTruncated("device_push_tokens", tokenRows.length, ceiling);

  const devices = newestPerUser(tokenRows, MAX_TARGETS_PER_USER);

  // #452: claim the high-priority budget ONCE for the whole fan-out, against
  // the device count, because the device is what the platforms ration. Past
  // the ceiling this comes back "normal" and every device still gets the
  // alert — degraded, never dropped.
  const urgency = delivery.highPriority
    ? await resolveHighPriority(env, db, delivery.highPriority, devices.length)
    : "normal";

  for (const device of devices) {
    try {
      // TTL rides the sender default: an ordinary alert is worth delivering
      // late, unlike a ring. Urgency does NOT — #414 needs HIGH to wake a
      // phone in Doze, which is the whole mechanism behind the emergency
      // promise.
      const result = await sendFcm(
        env,
        device,
        nativePayload,
        undefined,
        urgency,
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
