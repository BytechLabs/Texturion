/**
 * Notification preference + Web Push subscription routes (SPEC §7, §8) — any
 * active member. Mounted by the integration layer at /v1:
 *
 *   GET    /v1/notification-prefs        { email_enabled, push_enabled } for
 *          the caller in the active company. Rows are created at company
 *          creation and invite acceptance (defaults true/true); a missing row
 *          reads as those schema defaults.
 *   PUT    /v1/notification-prefs        { email_enabled, push_enabled } —
 *          upsert on (user_id, company_id).
 *   POST   /v1/push-subscriptions        { endpoint, keys: {p256dh, auth} }
 *          from PushSubscription.toJSON(); upsert on (user_id, endpoint) so a
 *          browser re-subscribe refreshes rotated keys. Subscriptions are
 *          per-user (§6: no company column) — the audience/prefs split
 *          happens at send time (§8).
 *   DELETE /v1/push-subscriptions/:id    caller's own subscription only.
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { decodeAuthSecret, decodeSubscriberKey } from "../notifications/webpush";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

const prefsSchema = z.object({
  email_enabled: z.boolean(),
  push_enabled: z.boolean(),
});

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
    const db = getDb(getEnv(c.env));
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
    return c.json(rows[0] ?? { email_enabled: true, push_enabled: true });
  },
);

notificationsRoutes.put(
  "/notification-prefs",
  requireRole("member"),
  async (c) => {
    const body = await parseJsonBody(c, prefsSchema);
    const db = getDb(getEnv(c.env));
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
    return c.json(rows[0]);
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
          },
          { onConflict: "user_id,endpoint" },
        )
        .select("id,endpoint,created_at"),
      "push subscription upsert",
    );
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
