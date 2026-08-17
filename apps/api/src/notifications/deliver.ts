import {
  DEFAULT_BATCH_WINDOW,
  decideDelivery,
  isMemberQuietNow,
  type Locale,
  type NotificationCategory,
  resolveUiLocale,
} from "@loonext/shared";
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
  /** #228: what THIS browser reads. Null on a row written before it was asked. */
  locale: string | null;
}

interface DeviceTokenRow {
  id: string;
  user_id: string;
  platform: "android" | "ios";
  token: string;
  /** #228: what THIS phone reads. Null on a row written before it was asked. */
  locale: string | null;
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
      /**
       * #228: a function of the reader's language, like `web` and `native`.
       *
       * The replacement is OUR sentence — "Sent you a message" — standing in
       * for somebody else's words. It is the one line a reader with content
       * switched off ever sees, so leaving it English would have made the
       * privacy setting the thing that turned the app back into English.
       */
      withheld: (locale: Locale) => Partial<Pick<PushPayload, "title" | "body">>;
    };

export interface PushDelivery {
  /** Push-enabled recipients. Nothing is sent for an empty list. */
  userIds: string[];
  /**
   * #430: whose words these are. See {@link PushContent} — required so that a
   * new push site cannot be added without answering the question.
   */
  /**
   * #244: whose workspace this alert belongs to.
   *
   * Required because notification preferences are keyed (user_id, company_id):
   * a member of two workspaces has two sets, and reading them by user alone
   * would apply the wrong workspace's quiet hours to this one's alerts. The
   * #347 scope guard caught exactly that on the first draft.
   */
  companyId: string;
  /**
   * #297: which volume control this obeys.
   *
   * `operational` is not one a member can turn down. A billing warning or a
   * number that finished porting is about their ACCOUNT rather than their
   * inbox, and filing it under a heading like "texts on anybody's jobs" would
   * put it somewhere nobody would think to look.
   *
   * Required, so a new push site has to say which control it answers to.
   * Defaulting it would mean the next one silently escapes the volume control
   * this issue exists to provide.
   */
  category: NotificationCategory | "operational";
  /**
   * #297: which thread this is about, when it is about one. The digest counts
   * DISTINCT conversations — "4 new messages across 3 conversations" — so a
   * batch that did not know would have to report the less useful number.
   */
  conversationId?: string;
  content: PushContent;
  /**
   * Notification content, as the apps/web service worker expects it.
   *
   * #228: a FUNCTION of the reader's language rather than a finished object,
   * and that is the whole design — the same reasoning as `content` and
   * `category` above. Every screen in all three apps is translated and every
   * push was composed in English, which is the half a member reads first, on a
   * lock screen, before they have opened anything. Taking a locale here means a
   * new push site cannot be added in one language by accident: there is nowhere
   * to put an English literal that does not visibly ignore its own argument.
   *
   * It cannot be a key the client resolves. iOS is sent a real
   * `notification: { title, body }` block that the system draws, there is no
   * notification service extension in apps/ios to rewrite it, and apps/web's
   * sw.js is served raw from public/ with no imports — so a key on the wire
   * would reach a lock screen as its own name on two clients out of three.
   */
  web: (locale: Locale) => PushPayload;
  /**
   * Native content. Defaults to the web one; set it only where the native
   * clients need something the service worker must not see, such as the
   * structural `kind` discriminator that picks an Android channel.
   */
  native?: (locale: Locale) => PushPayload;
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
   * #244 — this is somebody being called to duty, not a notification, so a
   * member's own quiet hours do not apply.
   *
   * It carries a REASON rather than being a bare boolean, for the same reason
   * `highPriority` does: overriding a person's stated wish to be left alone is
   * something every caller should have to justify in the diff, and an
   * unattributable override is not expressible.
   *
   * The two are separate on purpose. `highPriority` asks the PLATFORM to wake
   * a dozing phone; this asks US to ignore a preference. A missed call routed
   * to the on-call member is the second without being the first.
   */
  overridesQuietHours?: { reason: "on_call_page" | "escalation" };
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
interface CompanyPushSettings {
  /** #430: false means this workspace has asked us to keep words off screens. */
  includeContent: boolean;
  /** #228: the workspace's language — the last rung before English. */
  locale: string | null;
  /** True when the read itself failed, which withholds. See below. */
  unknown: boolean;
}

/**
 * The two things about a workspace that shape every push it sends: whether a
 * person's words may leave, and what language the fallback is in.
 *
 * ONE read for both. #228 needed the company's locale on the same path #430
 * already queried this table on, and a second round trip per notification to
 * fetch one adjacent column would be a cost with no argument behind it.
 *
 * It is now called on EVERY delivery rather than only the ones carrying
 * somebody's words. That is a real change: `written: "us"` sites used to skip
 * the query entirely. They cannot any more, because the language of a sentence
 * we wrote ourselves is exactly the thing this issue is about.
 */
async function companyPushSettings(
  db: SupabaseClient,
  companyId: string,
): Promise<CompanyPushSettings> {
  const { data, error } = await db
    .from("companies")
    .select("push_include_content,locale")
    .eq("id", companyId)
    .maybeSingle();
  if (error) {
    console.error(`push company settings lookup failed: ${error.message}`);
    return { includeContent: false, locale: null, unknown: true };
  }
  const row = data as {
    push_include_content?: boolean;
    locale?: string | null;
  } | null;
  return {
    includeContent: row?.push_include_content !== false,
    locale: row?.locale ?? null,
    unknown: false,
  };
}

/**
 * What must come OUT of this payload before it is serialized.
 *
 * A lookup FAILURE withholds. Every other fallback in this codebase fails to
 * the permissive default because the alternative is a dead product; here the
 * permissive default publishes a third party's words to a lock screen, and the
 * alert still arrives carrying the contact's name. Losing the snippet is a
 * degraded notification. Sending it against the workspace's instruction is the
 * thing this feature exists to prevent.
 */
function withheldFields(
  content: PushContent,
  company: CompanyPushSettings,
  locale: Locale,
): Partial<PushPayload> {
  if (content.written === "us") return {};
  if (company.unknown) return content.withheld(locale);
  return company.includeContent ? {} : content.withheld(locale);
}

/**
 * #228 — what language each member in this audience reads.
 *
 * Fails to an empty map rather than to English: an unanswerable read leaves
 * every reader on the device-then-company rungs below, which is strictly better
 * than asserting a language nobody chose.
 */
async function readerLocales(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const { data, error } = await db
    .from("profiles")
    .select("user_id,locale")
    .in("user_id", userIds);
  if (error) {
    console.error(`push reader locale lookup failed: ${error.message}`);
    return new Map();
  }
  return new Map(
    ((data ?? []) as { user_id: string; locale: string | null }[]).map((row) => [
      row.user_id,
      row.locale,
    ]),
  );
}

/**
 * #244 — drop the members whose own quiet hours are running.
 *
 * ONE READ, and it returns the input unchanged whenever it cannot answer.
 * Every failure direction here NOTIFIES: a read that errors, a row that is
 * missing, a window that will not parse. The asymmetry is deliberate and is
 * the opposite of #225's — silently withholding a message somebody was waiting
 * for is invisible to them, while an unwanted buzz is merely annoying and they
 * can see what happened.
 */
interface Audience {
  /** Push now. */
  send: string[];
  /** Hold for a batch, with the moment it comes due. */
  queue: { userId: string; deliverAt: Date }[];
}

/**
 * #244 + #297 — who hears about this now, who hears later, who does not.
 *
 * ONE READ answering two questions, because both come off the same row and
 * splitting them would mean two queries per push for one decision.
 *
 * EVERY FAILURE DIRECTION SENDS: a read that errors, a missing row, a window
 * that will not parse, a mode this build has never heard of. Silently
 * withholding a message somebody was waiting for is invisible to them, while
 * an unwanted buzz is merely annoying and they can see what happened.
 */
async function resolveAudience(
  db: SupabaseClient,
  companyId: string,
  category: NotificationCategory | "operational",
  userIds: string[],
): Promise<Audience> {
  const everybody: Audience = { send: userIds, queue: [] };

  const { data, error } = await db
    .from("notification_prefs")
    .select(
      "user_id,quiet_from,quiet_to,quiet_timezone,delivery," +
        "batch_window_minutes,companies(timezone)",
    )
    .eq("company_id", companyId)
    .in("user_id", userIds);
  if (error) {
    console.error(
      `delivery-prefs lookup failed, notifying anyway: ${error.message}`,
    );
    return everybody;
  }

  const rows = (data ?? []) as unknown as {
    user_id: string;
    quiet_from: string | null;
    quiet_to: string | null;
    quiet_timezone: string | null;
    delivery: Record<string, string> | null;
    batch_window_minutes: number | null;
    companies: { timezone: string | null } | null;
  }[];
  const byUser = new Map(rows.map((row) => [row.user_id, row]));
  const now = new Date();
  const audience: Audience = { send: [], queue: [] };

  for (const userId of userIds) {
    const row = byUser.get(userId);
    // No row means no preferences at all — every default, which is immediate
    // and no quiet hours. That is every existing member.
    if (!row) {
      audience.send.push(userId);
      continue;
    }

    if (
      isMemberQuietNow(
        { from: row.quiet_from, to: row.quiet_to, timezone: row.quiet_timezone },
        row.companies?.timezone ?? null,
        now,
      )
    ) {
      continue;
    }

    // `operational` has no volume control by design, so it never queues.
    const decision =
      category === "operational"
        ? "send"
        : decideDelivery({ mode: row.delivery?.[category], urgent: false });
    if (decision === "send") {
      audience.send.push(userId);
      continue;
    }

    const minutes = row.batch_window_minutes ?? DEFAULT_BATCH_WINDOW;
    audience.queue.push({
      userId,
      // Stamped NOW from the member's window, so lengthening the window later
      // does not retroactively delay a batch that was already nearly due.
      deliverAt: new Date(now.getTime() + minutes * 60_000),
    });
  }

  return audience;
}

/**
 * Park a notification until this member's batch closes.
 *
 * Best-effort by contract: a queue write that fails must not stop the members
 * who ARE being pushed to from hearing about it. The event is already durable
 * in the inbox — this row only decides whether a phone buzzes about it.
 */
async function queueForBatch(
  db: SupabaseClient,
  delivery: PushDelivery,
  queued: Audience["queue"],
): Promise<void> {
  const { error } = await db.from("pending_notifications").insert(
    queued.map((entry) => ({
      company_id: delivery.companyId,
      user_id: entry.userId,
      category: delivery.category,
      conversation_id: delivery.conversationId ?? null,
      deliver_at: entry.deliverAt.toISOString(),
    })),
  );
  if (error) {
    console.error(
      `could not queue ${queued.length} notification(s): ${error.message}`,
    );
  }
}

export async function deliverPush(
  env: Env,
  db: SupabaseClient,
  delivery: PushDelivery,
): Promise<void> {
  if (delivery.userIds.length === 0) return;

  // #244: a member's own do-not-disturb, applied HERE rather than at each of
  // the call sites — a new push site inherits it by construction, which is the
  // only way "quiet hours are respected" stays true as sites are added.
  //
  // A page skips it entirely: that is the emergency override, and it is what
  // makes the window safe to set. Somebody can silence the 1:40am customer
  // text without also silencing the night they are holding the phone.
  // #297: an event that overrides quiet hours IS the urgent one. The same
  // signal decides both, deliberately — two flags could disagree, and the one
  // that disagreed would be the one that delayed an emergency.
  const resolved = delivery.overridesQuietHours
    ? { send: delivery.userIds, queue: [] as Audience["queue"] }
    : await resolveAudience(
        db,
        delivery.companyId,
        delivery.category,
        delivery.userIds,
      );

  if (resolved.queue.length > 0) {
    await queueForBatch(db, delivery, resolved.queue);
  }

  const audience = resolved.send;
  if (audience.length === 0) return;

  /*
   * #228 — everything needed to answer "what language is this reader in".
   *
   * Both reads happen here, above the send loops, so the emergency path that
   * skips resolveAudience still gets them: an override means quiet hours do not
   * apply, not that the alert should arrive in the wrong language.
   */
  const [company, profileLocales] = await Promise.all([
    companyPushSettings(db, delivery.companyId),
    readerLocales(db, audience),
  ]);

  /*
   * One serialized payload per DISTINCT LANGUAGE present in this audience, not
   * per recipient. A crew that all reads the same language — which is nearly
   * every crew — serializes exactly once, as before.
   *
   * The cache is keyed on the resolved locale rather than the row, so the
   * composition function runs at most twice however many devices there are.
   */
  const webPayloads = new Map<Locale, string>();
  const nativePayloads = new Map<Locale, string>();

  const payloadFor = (
    cache: Map<Locale, string>,
    compose: (locale: Locale) => PushPayload,
    locale: Locale,
  ): string => {
    const cached = cache.get(locale);
    if (cached !== undefined) return cached;
    // The collapse key IS the tag: one identity, so no client has to invent
    // its own (#266). It is not language-dependent — two translations of one
    // alert must still replace each other rather than stack.
    // #430: withhold BEFORE serializing, so the content never exists in a
    // payload at all rather than being hidden by a client that might not.
    // Inside the per-locale composition since #228, because the sentence that
    // replaces somebody's words is our copy and has a translation.
    const serialized = JSON.stringify({
      ...compose(locale),
      ...withheldFields(delivery.content, company, locale),
      tag: delivery.collapseKey,
    });
    cache.set(locale, serialized);
    return serialized;
  };

  /**
   * The full ladder, per device: what the person chose, then what the device
   * reports, then the workspace's, then English.
   *
   * The device rung is the one that has never had a value on the server before
   * — see the migration. It is read off the row we are about to send TO, which
   * is why push is the one channel where it is a fact rather than a guess.
   */
  const localeFor = (row: { user_id: string; locale: string | null }): Locale =>
    resolveUiLocale(
      profileLocales.get(row.user_id) ?? null,
      row.locale,
      company.locale,
    );

  const ceiling = audience.length * MAX_TARGETS_PER_USER;

  const { data: subData, error: subError } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,locale")
    .in("user_id", audience)
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
        payloadFor(webPayloads, delivery.web, localeFor(subscription)),
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
    .select("id,user_id,platform,token,locale")
    .in("user_id", audience)
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
        payloadFor(
          nativePayloads,
          delivery.native ?? delivery.web,
          localeFor(device),
        ),
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
