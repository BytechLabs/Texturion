/**
 * Notification preference + Web Push subscription routes (SPEC §7, §8) AND the
 * derived notifications read-model (D24, HOME-AND-VIEWS.md).
 *
 * TWO gates, and the split is the point (#581). The prefs and subscription
 * routes are `workspace.access` — a person's own settings and their own
 * delivery targets, which every role owns. The read-model routes are
 * `conversations.read`, because what they serve is somebody else's customers.
 * This file predates the #315 presets, which is why it was all one gate.
 *
 * Mounted by the integration layer at /v1:
 *
 *   GET    /v1/notification-prefs        { email_enabled, push_enabled,
 *          vapid_public_key } for the caller in the active company. Rows are
 *          created at company creation and invite acceptance (defaults
 *          true/true); a missing row reads as those schema defaults.
 *          `vapid_public_key` is the server's VAPID application key (SPEC §8)
 *          — the browser needs it as `applicationServerKey` when calling
 *          PushManager.subscribe(), so the prefs read is where the web app
 *          picks it up (no separate config route, no rebuild on key rotation).
 *   PUT    /v1/notification-prefs        { email_enabled, push_enabled } —
 *          upsert on (user_id, company_id); echoes the same shape as GET.
 *   POST   /v1/push-subscriptions        { endpoint, keys: {p256dh, auth} }
 *          from PushSubscription.toJSON(); upsert on (user_id, endpoint) so a
 *          browser re-subscribe refreshes rotated keys. Subscriptions are
 *          per-user (§6: no company column) — the audience/prefs split
 *          happens at send time (§8). Capped per user (#30): a successful
 *          subscribe silently evicts everything older than the newest
 *          MAX_PUSH_SUBSCRIPTIONS_PER_USER rows.
 *   DELETE /v1/push-subscriptions/:id    caller's own subscription only.
 *
 *   --- D24 notifications read-model (lowest-upkeep: DERIVED, no feed table) ---
 *   GET    /v1/notifications             cursor list of recent notifications,
 *          (created_at, id) DESC. A UNION over existing sources (inbound in a
 *          thread assigned to me, assigned-to-me, task-assigned-to-me), each
 *          carrying an `unread` dot derived from the caller's last-seen
 *          watermark (notification_reads). Popover feed.
 *   GET    /v1/notifications/unread-count { count } — the bell badge.
 *   POST   /v1/notifications/mark-all-read  advance the watermark → the DB
 *          stamps now() itself (#188: item created_at values are DB-stamped,
 *          so the watermark must come from the SAME clock or a fresh item
 *          lands past it and the badge never zeroes) → { last_seen_at }.
 *   POST   /v1/notifications/:id/read    { created_at } — mark ONE
 *          notification read (#188). Per-item: newer AND older items keep
 *          their unread state. Idempotent; { newly_read } says whether this
 *          call flipped it.
 *   POST   /v1/notifications/mark-read   { before } — LEGACY watermark
 *          advance to a notification's timestamp (marks it and everything
 *          older read). Kept for deployed clients; new clients tap through
 *          POST /v1/notifications/:id/read instead.
 *
 *   Read state (one source of truth, #188): unread := created_at >
 *   notification_reads.last_seen_at AND id not in the caller's
 *   notification_read_items. Both read-model RPC twins apply that same
 *   predicate; both mark paths write only those two stores.
 */
import { Hono } from "hono";
import { z } from "zod";

import {
  DELIVERY_MODES,
  NOTIFICATION_CATEGORIES,
  normalizeDeviceLocale,
} from "@loonext/shared";

import { requireCapability } from "../auth/company";
import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { buildPage } from "../http/pagination";
import {
  decodeAuthSecret,
  decodeSubscriberKey,
  isAllowedPushEndpoint,
} from "../notifications/webpush";
import {
  parseCursor,
  parseJsonBody,
  parseLimit,
  pathUuid,
  unwrap,
} from "./core/http";

/**
 * "22:00" or "07:00" — a wall clock, not an instant.
 *
 * #552: THE SECONDS ARE OPTIONAL, and their absence was the founder's bug. These
 * are backed by Postgres `time` columns, and a `time` serialises to JSON as
 * "21:30:00" — so GET served a value that this schema then refused on the way
 * back, and quiet hours could not be saved at all. Proven:
 *
 *   select to_jsonb('21:30'::time)  ->  "21:30:00"
 *   /^([01]\d|2[0-3]):[0-5]\d$/.test("21:30:00")  ->  false
 *
 * A validator that rejects what its own GET just served is not strictness, it is
 * a round trip that cannot close. The seconds are accepted and dropped, so what
 * reaches the column is the wall clock the client meant either way.
 */
/**
 * The eight columns that ARE the preference, named once.
 *
 * #552: GET and the upsert echo each had their own list and they disagreed, so a
 * save returned a different object from the read it replaced. One constant, so
 * the round trip cannot lose a field again.
 */
const PREFS_COLUMNS =
  "email_enabled,push_enabled,quiet_from,quiet_to,quiet_timezone," +
  "delivery,batch_window_minutes,summary_at";

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  .transform((value) => value.slice(0, 5));

/**
 * #297: category -> mode. An ABSENT key means immediate, so a client that has
 * never heard of a category cannot accidentally quieten it by omission — which
 * matters because the phones ship on their own release cadence and will be
 * older than this Worker for weeks at a time.
 *
 * A string key with an explicit membership check rather than
 * `z.record(z.enum(...), ...)`: a keyed enum record is EXHAUSTIVE in Zod, so
 * it would reject the partial object this endpoint is built around — every
 * client sends only the categories somebody has actually changed.
 */
const deliverySchema = z
  .record(z.string(), z.enum(DELIVERY_MODES))
  .refine(
    (value) =>
      Object.keys(value).every((key) =>
        (NOTIFICATION_CATEGORIES as readonly string[]).includes(key),
      ),
    { message: "Unknown notification category" },
  );

const prefsSchema = z.object({
  email_enabled: z.boolean(),
  push_enabled: z.boolean(),
  /**
   * #244: both or neither. One half of a window is not a window, and a row
   * with a start and no end would silence a phone until somebody noticed —
   * which is why the DB carries the same constraint.
   */
  quiet_from: clockTime.nullable().optional(),
  quiet_to: clockTime.nullable().optional(),
  /** The member's own zone. Null falls back to the workspace's. */
  quiet_timezone: z.string().max(64).nullable().optional(),
  /** #297: how loud each category is. Absent keys mean immediate. */
  delivery: deliverySchema.optional(),
  batch_window_minutes: z
    .number()
    .int()
    .min(5)
    .max(60)
    .nullable()
    .optional(),
  /** When the daily summary goes, in the member's own clock. Null = none. */
  summary_at: clockTime.nullable().optional(),
}).refine(
  (value) =>
    (value.quiet_from ?? null) === null ? (value.quiet_to ?? null) === null
      : (value.quiet_to ?? null) !== null,
  { message: "Quiet hours need both a start and an end" },
);

/**
 * #30 cap-and-drop: at most this many live push subscriptions per user. Each
 * subscription row is one outbound Worker subrequest per notified inbound
 * message (§8 fan-out), so an unbounded set is a paid-CPU / subrequest-budget
 * burner and a small request-amplification primitive. A successful subscribe
 * evicts everything older than the newest N (oldest first, silently) rather
 * than 409ing — a browser re-subscribing after a long absence should always
 * win, and the rows it displaces are the ones least likely to still be live.
 */
const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

const subscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    /*
     * #576 (2): the HOST, not just the scheme.
     *
     * `https://` alone made this a request-forwarding primitive — any member
     * could store any URL and have the Worker POST to it, with our egress and
     * our retries behind the request. The same predicate runs again at the
     * send, because rows stored before this gate existed are still in the
     * table; refusing here is the courtesy, refusing there is the protection.
     */
    .refine(isAllowedPushEndpoint, {
      message:
        "push endpoints must be https URLs at a known push service " +
        "(FCM, Apple, Mozilla or WNS).",
    }),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }),
  /**
   * Calls v3 (#170 §9.2): capabilities this subscription declares — e.g.
   * ["call_end"]. Delivery of the call_end revocation push is caps-gated so no
   * pre-update service worker ever renders a stray notification (§8.5.4).
   */
  caps: z.array(z.string().max(64)).max(16).optional(),
  /**
   * #228: the language THIS device reads, so a push can be composed in it.
   *
   * The DEVICE rung of resolveUiLocale, which has never had a value on the
   * server before — see the migration for why push is the one channel where
   * the device is a row rather than a guess.
   *
   * Free-form on the wire and normalised on the way in, NOT an enum: the
   * phone is reporting a fact about itself rather than making a request that
   * can fail, and an unsupported language should be stored as silence.
   *
   * `.catch` IS THE LOAD-BEARING PART, not the bound. A schema miss here
   * would be a 422 on the WHOLE body, and both registrars treat that as a
   * failed registration — so one unexpected tag would cost that device every
   * push it was ever going to get, not merely its language. Android 14's
   * regional preferences alone can push a language tag past any bound worth
   * setting (`fr-CA-u-fw-mon-hc-h12-mu-fahrenhe-nu-latn`), and the client
   * cannot clamp it without becoming the normaliser this field exists to keep
   * on the server. So the server degrades instead: an unusable value reads as
   * silence, and the registration it rode in on still succeeds.
   */
  locale: z.string().max(100).optional().catch(undefined),
});

interface PrefsRow {
  email_enabled: boolean;
  push_enabled: boolean;
  /** #297: category -> mode, `{}` for a member who has changed nothing. */
  delivery?: Record<string, string>;
  batch_window_minutes?: number | null;
  summary_at?: string | null;
  /** #244: null on every member who has not set a window. */
  quiet_from?: string | null;
  quiet_to?: string | null;
  quiet_timezone?: string | null;
}

/**
 * #343 — whether the workspace's daily notification allowance is spent, and
 * when it comes back. `resets_at` is the company's next LOCAL midnight, which
 * is the thing the owner's alert copy has been implying and getting wrong in
 * every timezone.
 */
interface AlertPause {
  email_paused: boolean;
  push_paused: boolean;
  resets_at: string;
}

export const notificationsRoutes = new Hono<AppEnv>();

notificationsRoutes.get(
  "/notification-prefs",
  requireCapability("workspace.access"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const rows = unwrap<PrefsRow[]>(
      await db
        .from("notification_prefs")
        .select(PREFS_COLUMNS)
        .eq("user_id", c.get("userId"))
        .eq("company_id", c.get("companyId"))
        .limit(1),
      "notification prefs lookup",
    );
    // §6 schema defaults — the shape the row would have been created with.
    const prefs = rows[0] ?? {
      email_enabled: true,
      push_enabled: true,
      // #244: no window, which is every existing member.
      quiet_from: null,
      quiet_to: null,
      quiet_timezone: null,
      // #297: no category quietened, no window, no summary — which is what
      // every member receives today.
      delivery: {},
      batch_window_minutes: null,
      summary_at: null,
    };
    return c.json({ ...prefs, vapid_public_key: env.VAPID_PUBLIC_KEY });
  },
);

notificationsRoutes.put(
  "/notification-prefs",
  requireCapability("workspace.access"),
  async (c) => {
    const body = await parseJsonBody(c, prefsSchema);
    const env = getEnv(c.env);
    const db = getDb(env);
    const rows = unwrap<PrefsRow[]>(
      await db
        .from("notification_prefs")
        .upsert(
          {
            user_id: c.get("userId"),
            company_id: c.get("companyId"),
            email_enabled: body.email_enabled,
            push_enabled: body.push_enabled,
            // Omitted means "leave it alone" would be ambiguous with "clear
            // it", so the client always sends all three: this is the whole
            // preference, replaced.
            quiet_from: body.quiet_from ?? null,
            quiet_to: body.quiet_to ?? null,
            quiet_timezone: body.quiet_timezone ?? null,
            // Same rule as the quiet window above: the client always sends the
            // whole preference, so an omitted field CLEARS rather than
            // preserves. Otherwise turning a category back to immediate would
            // be impossible to express.
            delivery: body.delivery ?? {},
            batch_window_minutes: body.batch_window_minutes ?? null,
            summary_at: body.summary_at ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,company_id" },
        )
        .select(PREFS_COLUMNS),
      "notification prefs upsert",
    );
    // #552: the SAME shape as GET, which this comment already claimed and the
    // code did not do — it selected two of the eight columns. Every client
    // replaces its whole state with this response, so a save of Email or Push
    // came back without the grouping or the quiet window and they vanished from
    // the screen. Worse, the NEXT save wrote that truncated state back, and
    // because an omitted field CLEARS here by design, the grouping was then gone
    // from the database as well. A toggle quietly deleting a neighbouring
    // setting is the shape of defect the founder was describing.
    return c.json({ ...rows[0], vapid_public_key: env.VAPID_PUBLIC_KEY });
  },
);

notificationsRoutes.post(
  "/push-subscriptions",
  requireCapability("workspace.access"),
  async (c) => {
    const body = await parseJsonBody(c, subscriptionSchema);
    // Reject keys the §8 send path could never encrypt to (base64url 65-byte
    // uncompressed P-256 point + 16-byte auth secret) at subscribe time, not
    // at first inbound message.
    try {
      decodeSubscriberKey(body.keys.p256dh);
      decodeAuthSecret(body.keys.auth);
    } catch {
      throw new ApiError(
        "validation_failed",
        "keys: not a valid Web Push p256dh/auth pair.",
      );
    }

    const db = getDb(getEnv(c.env));
    const rows = unwrap<{ id: string; endpoint: string; created_at: string }[]>(
      await db
        .from("push_subscriptions")
        .upsert(
          {
            user_id: c.get("userId"),
            endpoint: body.endpoint,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
            user_agent: c.req.header("User-Agent") ?? null,
            // #236: the browser that subscribed. Signing that session out
            // takes the subscription with it, so a signed-out browser stops
            // showing customer message text in a notification.
            session_id: c.get("sessionId") ?? null,
            ...(body.caps ? { caps: body.caps } : {}),
            // Spread, not a plain assign: an absent field must not clobber
            // what an earlier subscribe already told us. Same as caps.
            ...(normalizeDeviceLocale(body.locale)
              ? { locale: normalizeDeviceLocale(body.locale) }
              : {}),
          },
          { onConflict: "user_id,endpoint" },
        )
        .select("id,endpoint,created_at"),
      "push subscription upsert",
    );

    // #30 cap-and-drop: keep only the caller's newest N subscriptions. The
    // newest-N read + delete-older-than-cutoff pair evicts ANY backlog in one
    // bounded statement (self-healing for rows that predate the cap), and a
    // re-subscribe upsert keeps its original created_at, so refreshing an old
    // endpoint never evicts anything.
    const userId = c.get("userId");
    const newest = unwrap<{ created_at: string }[]>(
      await db
        .from("push_subscriptions")
        .select("created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(MAX_PUSH_SUBSCRIPTIONS_PER_USER),
      "push subscription cap lookup",
    );
    if (newest.length === MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
      unwrap<{ id: string }[]>(
        await db
          .from("push_subscriptions")
          .delete()
          .eq("user_id", userId)
          .lt("created_at", newest[newest.length - 1].created_at)
          .select("id"),
        "push subscription cap eviction",
      );
    }

    return c.json(rows[0], 201);
  },
);

notificationsRoutes.delete(
  "/push-subscriptions/:id",
  requireCapability("workspace.access"),
  async (c) => {
    const id = pathUuid(c, "id");
    const db = getDb(getEnv(c.env));
    const deleted = unwrap<{ id: string }[]>(
      await db
        .from("push_subscriptions")
        .delete()
        .eq("id", id)
        .eq("user_id", c.get("userId")) // callers manage only their own
        .select("id"),
      "push subscription delete",
    );
    if (deleted.length === 0) {
      return errorResponse(c, "not_found", "No such push subscription.");
    }
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// D24 notifications read-model — DERIVED (no feed table). Recent notifications
// are a UNION over existing sources; the `unread` dot + "mark read" ride a
// per-user last-seen watermark (notification_reads). All company-scoped (§10).
// ---------------------------------------------------------------------------

/** One derived notification item (api_notifications RPC row shape). */
interface NotificationRow {
  id: string;
  created_at: string;
  type: string;
  conversation_id: string | null;
  message_id: string | null;
  task_id: string | null;
  contact: { id: string; name: string | null; phone_e164: string } | null;
  unread: boolean;
}

const markReadSchema = z.object({
  // A notification's created_at: advance the watermark to it, marking that
  // item and everything older read. ISO 8601 with offset (matches cursor ts).
  before: z.iso.datetime({ offset: true }),
});

const markOneReadSchema = z.object({
  // The tapped item's created_at exactly as the feed returned it. The RPC
  // stores it beside the id so watermark advances can prune covered rows and
  // an already-covered item is a clean no-op (#188).
  created_at: z.iso.datetime({ offset: true }),
});

notificationsRoutes.get(
  "/notifications",
  // #581: the FEED is conversation data, not workspace data. Every row it
  // returns carries `contact.name` and `contact.phone_e164`, and the missed-call
  // arm matches unassigned threads — so gated on the baseline capability every
  // role holds, a `bookkeeper` (billing and deliberately no inbox at all) could
  // poll the whole workspace's customers out of it. The prefs and
  // push-subscription routes above stay on `workspace.access` on purpose: those
  // are a person's own settings, which is what the baseline is for.
  requireCapability("conversations.read"),
  async (c) => {
    const limit = parseLimit(c, 25, 100);
    const cursor = parseCursor(c);
    const db = getDb(getEnv(c.env));

    // #106: a restricted member's feed must exclude hidden-number threads/tasks.
    const access = await resolveNumberAccess(db, {
      companyId: c.get("companyId"),
      userId: c.get("userId"),
      role: c.get("role"),
    });
    const rows = unwrap<NotificationRow[]>(
      await db.rpc("api_notifications", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_limit: limit + 1,
        p_before_ts: cursor?.ts ?? null,
        p_before_id: cursor?.id ?? null,
        p_hidden_number_ids: access.hiddenNumberIds,
      }),
      "notifications list",
    );
    return c.json(buildPage(rows, limit, "created_at"));
  },
);

notificationsRoutes.get(
  "/notifications/unread-count",
  // #581: the badge counts the same rows the feed lists, so it answers to the
  // same capability. A count that a role cannot open is also a probe — "how many
  // customers reached this business today" is itself the answer.
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    // #106: the badge must agree with the filtered feed.
    const access = await resolveNumberAccess(db, {
      companyId: c.get("companyId"),
      userId: c.get("userId"),
      role: c.get("role"),
    });
    // #343: the badge and the pause state travel together. At the daily
    // ceiling notifications stop reaching EVERY member while only the owner is
    // emailed — a tech's phone simply goes quiet and, from their side, the
    // business had a slow afternoon. This is the endpoint every client already
    // polls on a timer, so the signal rides it rather than adding a second one.
    // Two RPCs in parallel: the pause read is one indexed join, and it must not
    // add latency to a badge poll.
    const [countResult, pauseResult] = await Promise.all([
      db.rpc("api_notifications_unread_count", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_hidden_number_ids: access.hiddenNumberIds,
      }),
      db.rpc("api_notification_pause", { p_company_id: c.get("companyId") }),
    ]);
    const count = Number(
      unwrap<number | string>(countResult, "notifications unread count"),
    );
    return c.json({
      count,
      alert_pause: unwrap<AlertPause>(pauseResult, "notification pause"),
    });
  },
);

notificationsRoutes.post(
  "/notifications/mark-all-read",
  requireCapability("workspace.access"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    // #188: p_now null → the RPC stamps the DB's own now(). Notification
    // created_at values are DB-stamped, and the Worker's Date (frozen between
    // I/O, on a different clock entirely) could land BEFORE the newest item,
    // leaving the badge nonzero after "mark all read". Same clock both sides.
    const lastSeen = unwrap<string>(
      await db.rpc("api_mark_notifications_read", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_now: null,
      }),
      "notifications mark-all-read",
    );
    return c.json({ last_seen_at: lastSeen });
  },
);

notificationsRoutes.post(
  "/notifications/:id/read",
  requireCapability("workspace.access"),
  async (c) => {
    const id = pathUuid(c, "id");
    const body = await parseJsonBody(c, markOneReadSchema);
    const db = getDb(getEnv(c.env));
    // #188 per-item mark-read: opening a notification marks THAT item read —
    // newer and older items keep their unread state (unlike the watermark
    // paths). Idempotent: re-marking reports newly_read false. The id is only
    // ever subtracted from the caller's own unread set, so no existence or
    // visibility check is needed (an invented id costs one capped row).
    const newlyRead = unwrap<boolean>(
      await db.rpc("api_mark_notification_read", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_notification_id: id,
        p_created_at: body.created_at,
      }),
      "notification mark-one-read",
    );
    return c.json({ newly_read: newlyRead });
  },
);

notificationsRoutes.post(
  "/notifications/mark-read",
  requireCapability("workspace.access"),
  async (c) => {
    const body = await parseJsonBody(c, markReadSchema);
    const db = getDb(getEnv(c.env));
    // LEGACY watermark model (pre-#188 clients): advances the per-user
    // last-seen to that notification's timestamp, marking it AND everything
    // older read (the RPC keeps the greatest, so this never moves the
    // watermark backwards). New clients use POST /notifications/:id/read.
    const lastSeen = unwrap<string>(
      await db.rpc("api_mark_notifications_read", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_now: body.before,
      }),
      "notifications mark-read",
    );
    return c.json({ last_seen_at: lastSeen });
  },
);
