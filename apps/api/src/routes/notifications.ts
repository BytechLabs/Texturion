/**
 * Notification preference + Web Push subscription routes (SPEC §7, §8) AND the
 * derived notifications read-model (D24, HOME-AND-VIEWS.md) — any active member.
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

import { requireRole } from "../auth/company";
import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { buildPage } from "../http/pagination";
import { decodeAuthSecret, decodeSubscriberKey } from "../notifications/webpush";
import {
  parseCursor,
  parseJsonBody,
  parseLimit,
  pathUuid,
  unwrap,
} from "./core/http";

const prefsSchema = z.object({
  email_enabled: z.boolean(),
  push_enabled: z.boolean(),
});

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
    .refine((value) => value.startsWith("https://"), {
      message: "push endpoints must be https URLs.",
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
});

interface PrefsRow {
  email_enabled: boolean;
  push_enabled: boolean;
}

export const notificationsRoutes = new Hono<AppEnv>();

notificationsRoutes.get(
  "/notification-prefs",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const rows = unwrap<PrefsRow[]>(
      await db
        .from("notification_prefs")
        .select("email_enabled,push_enabled")
        .eq("user_id", c.get("userId"))
        .eq("company_id", c.get("companyId"))
        .limit(1),
      "notification prefs lookup",
    );
    // §6 schema defaults — the shape the row would have been created with.
    const prefs = rows[0] ?? { email_enabled: true, push_enabled: true };
    return c.json({ ...prefs, vapid_public_key: env.VAPID_PUBLIC_KEY });
  },
);

notificationsRoutes.put(
  "/notification-prefs",
  requireRole("member"),
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
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,company_id" },
        )
        .select("email_enabled,push_enabled"),
      "notification prefs upsert",
    );
    // Same shape as GET so client caches never lose the key on a toggle save.
    return c.json({ ...rows[0], vapid_public_key: env.VAPID_PUBLIC_KEY });
  },
);

notificationsRoutes.post(
  "/push-subscriptions",
  requireRole("member"),
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
            ...(body.caps ? { caps: body.caps } : {}),
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
  requireRole("member"),
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
  requireRole("member"),
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
  requireRole("member"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    // #106: the badge must agree with the filtered feed.
    const access = await resolveNumberAccess(db, {
      companyId: c.get("companyId"),
      userId: c.get("userId"),
      role: c.get("role"),
    });
    const count = Number(
      unwrap<number | string>(
        await db.rpc("api_notifications_unread_count", {
          p_company_id: c.get("companyId"),
          p_user_id: c.get("userId"),
          p_hidden_number_ids: access.hiddenNumberIds,
        }),
        "notifications unread count",
      ),
    );
    return c.json({ count });
  },
);

notificationsRoutes.post(
  "/notifications/mark-all-read",
  requireRole("member"),
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
  requireRole("member"),
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
  requireRole("member"),
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
