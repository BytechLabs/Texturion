/**
 * #245 — getting, rotating and revoking your own schedule URL.
 *
 * Separate from `calendar-feed.ts` because the two have opposite security
 * shapes and putting them together is how one inherits the other's mistake: the
 * feed is public and authenticated by a bearer token in a URL, and these are
 * `/v1` routes behind a session that only ever act on the CALLER's own feed.
 *
 * There is no route here that reads, rotates or revokes somebody else's. Not
 * because an owner could not be trusted with it, but because the credential is
 * a bearer token that gets pasted into third-party apps — handing one person
 * another person's is a different feature with a different consent question,
 * and the absence of the route is what makes that decision visible.
 */
import { Hono } from "hono";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { generateToken, hashToken } from "../public-links/tokens";
import { unwrap } from "./core/http";

export const calendarRoutes = new Hono<AppEnv>();

/** The URL a member pastes into their calendar app. */
function feedUrl(origin: string, token: string): string {
  return `${origin}/calendar/${token}/schedule.ics`;
}

/**
 * Mint, replacing whatever was there.
 *
 * POST rather than GET, and it ROTATES rather than returning the existing one,
 * because the plaintext is not stored — only its hash is, like every other
 * bearer credential here. So "show me my URL again" is not a question this can
 * answer, and pretending otherwise would mean keeping the token readable.
 *
 * The screen says so: the URL is shown once, and losing it means rotating.
 */
calendarRoutes.post(
  "/calendar/feed",
  requireCapability("conversations.read"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const token = generateToken();

    unwrap<string>(
      await db.rpc("api_mint_calendar_feed_token", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
        p_token_hash: await hashToken(token),
      }),
      "calendar feed mint",
    );

    return c.json({ url: feedUrl(env.APP_ORIGIN, token) }, 201);
  },
);

/**
 * Stop the current URL working, without issuing another.
 *
 * Separate from rotation deliberately: "I pasted that somewhere I regret" and
 * "give me a new one" are different intentions, and somebody acting on the
 * first should not be handed a second secret to look after.
 */
calendarRoutes.delete(
  "/calendar/feed",
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));

    const revoked = unwrap<number>(
      await db.rpc("api_revoke_calendar_feed_token", {
        p_company_id: c.get("companyId"),
        p_user_id: c.get("userId"),
      }),
      "calendar feed revoke",
    );

    // 200 either way. Revoking a feed that was already revoked is the same
    // outcome the caller wanted, and a 404 would only tell somebody clicking
    // twice that they had done something wrong.
    return c.json({ revoked: revoked > 0 });
  },
);

/**
 * Whether a feed is live, and when it was last polled — never the URL.
 *
 * `last_read_at` is the useful half: a member who cannot remember whether they
 * finished setting this up can tell from "last read 4 minutes ago", and an
 * owner asking whether it is worth keeping has an answer that is not a guess.
 */
calendarRoutes.get(
  "/calendar/feed",
  requireCapability("conversations.read"),
  async (c) => {
    const db = getDb(getEnv(c.env));

    const rows = unwrap<{ created_at: string; last_read_at: string | null }[]>(
      await db
        .from("calendar_feed_tokens")
        .select("created_at,last_read_at")
        .eq("company_id", c.get("companyId"))
        .eq("user_id", c.get("userId"))
        .is("revoked_at", null)
        .limit(1),
      "calendar feed status",
    );

    const row = rows[0];
    if (!row) return c.json({ active: false });
    return c.json({
      active: true,
      created_at: row.created_at,
      last_read_at: row.last_read_at,
    });
  },
);

