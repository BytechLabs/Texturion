/**
 * #245 — a member's scheduled work, in the calendar they already use.
 *
 * ## Why this exists before the sync
 *
 * The issue asks for two-way Google and Microsoft sync as the real deliverable
 * and says to ship this first, because it is "a fraction of the work of full
 * sync and captures most of the value". It is also the only thing that will
 * ever serve Apple Calendar, Fastmail, Thunderbird and whatever the
 * bookkeeper's spouse uses — a connector is per-vendor, a feed is universal.
 *
 * ## What a subscriber is trusted with
 *
 * Nothing beyond what the member already sees, and the scoping is applied HERE
 * on every poll rather than frozen into the token:
 *
 * * Only tasks ASSIGNED to that member. A calendar is personal; the crew's
 *   whole schedule on one person's phone is a different feature with a
 *   different consent question.
 * * Only tasks with a due date. A task with no date is a to-do, and a calendar
 *   cannot show it without inventing a time.
 * * #106 number access, resolved per request. A member who loses access to a
 *   line stops seeing its work at the next poll, with nobody re-issuing
 *   anything.
 *
 * ## Why the response is deliberately dull
 *
 * A calendar client polls this every few minutes forever, from an IP we have
 * never seen, with no session. So: no cache that would outlive a revoke, the
 * same 404 for every failure, and the public security headers every other
 * unauthenticated surface carries.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";

import { buildIcs, roleHasCapability } from '@loonext/shared';
import type { IcsEvent, MemberRole } from '@loonext/shared';

import { taskLinkUrl, withTaskLink } from "../calendar/providers/normalize";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { hashToken } from "../public-links/tokens";
import { PUBLIC_PAGE_HEADERS } from "../public-links/guard";

const HISTORY_MS = 90 * 86_400_000;

export const calendarFeedRoutes = new Hono<AppEnv>();

/**
 * #744 — the web app fetches the link it just created to prove it answers, so
 * the app's own origin (and no other) may read the feed. The token is already
 * the credential; this only lets the page that minted it check the result.
 */
calendarFeedRoutes.use(
  "/calendar/*",
  cors({
    origin: (origin, c) => (origin === getEnv(c.env).APP_ORIGIN ? origin : null),
    allowMethods: ["GET", "HEAD"],
  }),
);

/**
 * How long an undated job occupies, when a calendar insists on a duration.
 *
 * A task carries a due time, not a span — we do not know how long the work
 * takes and inventing a number would put a confident lie in somebody's day.
 * One hour is the shortest block that still reads as an appointment rather
 * than a reminder, and the description says what it is.
 */
const DEFAULT_MINUTES = 60;

interface FeedReader {
  company_id: string;
  user_id: string;
  role: MemberRole;
  company_name: string;
}

interface FeedTask {
  id: string;
  title: string;
  description: string;
  due_at: string;
  addr_street: string | null;
  addr_unit: string | null;
  addr_city: string | null;
  addr_state: string | null;
  addr_postal_code: string | null;
  updated_at: string | null;
}

/** One line, in the order somebody would write it on an envelope. */
function addressOf(task: FeedTask): string | undefined {
  const parts = [
    [task.addr_street, task.addr_unit].filter(Boolean).join(" "),
    task.addr_city,
    task.addr_state,
    task.addr_postal_code,
  ].filter((part) => typeof part === "string" && part.length > 0);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * The feed. No session, no company header — the token IS the credential.
 *
 * `.ics` on the path rather than a query parameter: some clients decide how to
 * handle a subscription from the extension before they ever read the
 * content-type, and a URL that ends in a token looks to a human like something
 * to trim.
 */
calendarFeedRoutes.get("/calendar/:token/schedule.ics", async (c) => {
  for (const [name, value] of Object.entries(PUBLIC_PAGE_HEADERS)) {
    c.header(name, value);
  }

  const env = getEnv(c.env);
  const db = getDb(env);
  const token = c.req.param("token");

  /*
   * The same answer for every failure — revoked, never existed, malformed.
   * A calendar client shows the reason to nobody, so the only reader of a
   * distinct error would be somebody probing for live tokens.
   */
  const notFound = () => c.text("Not found", 404);

  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return notFound();

  const { data: resolved, error: resolveError } = await db.rpc(
    "api_resolve_calendar_feed_token",
    { p_token_hash: await hashToken(token) },
  );
  if (resolveError) {
    console.error(`calendar feed resolve failed: ${resolveError.message}`);
    return notFound();
  }
  const reader = (resolved as FeedReader[] | null)?.[0];
  if (!reader || !roleHasCapability(reader.role, "conversations.read")) return notFound();

  const { data: taskRows, error: taskError } = await db.rpc(
    "api_calendar_feed_tasks",
    {
      p_company_id: reader.company_id,
      p_user_id: reader.user_id,
      p_since: new Date(Date.now() - HISTORY_MS).toISOString(),
    },
  );
  if (taskError) {
    console.error(`calendar feed tasks failed: ${taskError.message}`);
    return notFound();
  }

  const events: IcsEvent[] = ((taskRows ?? []) as FeedTask[]).map(
    (task) => {
    const start = new Date(task.due_at);
    const taskUrl = taskLinkUrl(env.APP_ORIGIN, task.id);
    return {
      /*
       * Stable for the life of the task, so a rescheduled job MOVES in the
       * subscriber's calendar instead of appearing twice. The domain suffix is
       * what makes it unique across the internet rather than just across this
       * workspace, which is what the format asks for.
       */
      uid: `task-${task.id}@loonext.com`,
      start,
      end: new Date(start.getTime() + DEFAULT_MINUTES * 60_000),
      // The last time WE changed it, so a client comparing two copies keeps
      // the newer. Falling back to the due date rather than to now(): a stamp
      // of now() on every poll tells every client that every event changed.
      stamp: task.updated_at ? new Date(task.updated_at) : start,
      summary: task.title,
      // Google Calendar shows no URL property on a subscribed feed, so the link
      // back to the task is also the description's last line (#751).
      description: withTaskLink(task.description ?? "", taskUrl),
      location: addressOf(task),
      url: taskUrl,
      };
    },
  );

  const body = buildIcs({
    name: `${reader.company_name} — my schedule`,
    events,
  });

  return c.body(body, 200, {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": 'inline; filename="schedule.ics"',
  });
});
