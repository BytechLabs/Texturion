/**
 * Native device push-token registration (#151) — the FCM/APNs sibling of the
 * Web Push subscription routes in routes/notifications.ts. Mounted by the
 * integration layer at /v1:
 *
 *   POST   /v1/device-push-tokens   { platform: 'android'|'ios', token }
 *          from the device SDK (FirebaseMessaging.getToken() — iOS delivery
 *          rides FCM's APNs bridge, so both platforms register an FCM token).
 *          Upsert on (user_id, token): a re-register after app restart
 *          refreshes platform + last_seen_at instead of duplicating the row.
 *          Capped per user exactly like #30: a successful register silently
 *          evicts everything older than the newest MAX_DEVICE_PUSH_TOKENS_
 *          PER_USER rows.
 *   DELETE /v1/device-push-tokens   { token } — caller's own row only (404
 *          otherwise). By token, not id: sign-out deletes the token the device
 *          still holds without having stored the row id anywhere.
 *
 * BEARER-ONLY (no X-Company-Id, listed in COMPANY_EXEMPT_ROUTES): tokens are
 * per-USER like push_subscriptions (§6 — no company column; the audience/prefs
 * split happens at send time, §8), and a native app registers its token right
 * after sign-in, before any company is selected.
 */
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { parseJsonBody, unwrap } from "./core/http";

/**
 * #30 mirror, cap-and-drop: at most this many live device tokens per user.
 * Each row is one outbound FCM subrequest per notified event (§8 fan-out), so
 * an unbounded set is a paid-CPU / subrequest-budget burner. A successful
 * register evicts oldest-first (silently) rather than 409ing — a device
 * re-registering after a long absence should always win.
 */
const MAX_DEVICE_PUSH_TOKENS_PER_USER = 10;

/**
 * FCM registration tokens are opaque strings (~150–350 chars today); bound
 * generously but firmly so the row (and the send subrequest) stays small.
 */
const tokenSchema = z.string().min(1).max(4096);

const registerSchema = z.object({
  platform: z.enum(["android", "ios"]),
  token: tokenSchema,
});

const removeSchema = z.object({
  token: tokenSchema,
});

export const devicePushTokensRoutes = new Hono<AppEnv>();

devicePushTokensRoutes.post("/device-push-tokens", async (c) => {
  const body = await parseJsonBody(c, registerSchema);
  const db = getDb(getEnv(c.env));
  const userId = c.get("userId");

  const rows = unwrap<{ id: string; platform: string; created_at: string }[]>(
    await db
      .from("device_push_tokens")
      .upsert(
        {
          user_id: userId,
          platform: body.platform,
          token: body.token,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "user_id,token" },
      )
      .select("id,platform,created_at"),
    "device push token upsert",
  );

  // Cap-and-drop (#30 mirror): keep only the caller's newest N tokens. The
  // newest-N read + delete-older-than-cutoff pair evicts ANY backlog in one
  // bounded statement, and a re-register upsert keeps its original
  // created_at, so refreshing an old device never evicts anything.
  const newest = unwrap<{ created_at: string }[]>(
    await db
      .from("device_push_tokens")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_DEVICE_PUSH_TOKENS_PER_USER),
    "device push token cap lookup",
  );
  if (newest.length === MAX_DEVICE_PUSH_TOKENS_PER_USER) {
    unwrap<{ id: string }[]>(
      await db
        .from("device_push_tokens")
        .delete()
        .eq("user_id", userId)
        .lt("created_at", newest[newest.length - 1].created_at)
        .select("id"),
      "device push token cap eviction",
    );
  }

  // The token itself is never echoed back — the device already holds it.
  return c.json(rows[0], 201);
});

devicePushTokensRoutes.delete("/device-push-tokens", async (c) => {
  const body = await parseJsonBody(c, removeSchema);
  const db = getDb(getEnv(c.env));
  const deleted = unwrap<{ id: string }[]>(
    await db
      .from("device_push_tokens")
      .delete()
      .eq("user_id", c.get("userId")) // callers manage only their own
      .eq("token", body.token)
      .select("id"),
    "device push token delete",
  );
  if (deleted.length === 0) {
    return errorResponse(c, "not_found", "No such device push token.");
  }
  return c.body(null, 204);
});
