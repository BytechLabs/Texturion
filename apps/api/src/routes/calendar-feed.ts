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

import { buildIcs, type IcsEvent } from "@loonext/shared";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { resolveNumberAccess } from "../auth/number-access";
import { hashToken } from "../public-links/tokens";
import { PUBLIC_PAGE_HEADERS } from "../public-links/guard";

export const calendarFeedRoutes = new Hono<AppEnv>();

/**
 * How long an undated job occupies, when a calendar insists on a duration.
 *
 * A task carries a due time, not a span — we do not know how long the work
 * takes and inventing a number would put a confident lie in somebody's day.
 * One hour is the shortest block that still reads as an appointment rather
 * than a reminder, and the description says what it is.
 */
const DEFAULT_MINUTES = 60;

interface FeedTask {
  id: string;
  title: string;
  description: string;
  due_at: string;
  conversation_id: string | null;
  addr_street: string | null;
  addr_unit: string | null;
  addr_city: string | null;
  addr_state: string | null;
  addr_postal_code: string | null;
  updated_at: string | null;
  conversations: { phone_number_id: string | null } | null;
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
  const reader = (resolved as { company_id: string; user_id: string }[])?.[0];
  if (!reader) return notFound();

  const company = (
    await db
      .from("companies")
      .select("name")
      .eq("id", reader.company_id)
      .limit(1)
  ).data as { name: string }[] | null;
  const businessName = company?.[0]?.name ?? "Loonext";

  /*
   * #106, resolved on every poll. A member restricted off a line must not read
   * its work here — this feed is a second door onto the same rows the inbox
   * refuses them, and the whole point of a per-member credential is that it
   * carries no more than the member does.
   */
  const access = await resolveNumberAccess(db, {
    companyId: reader.company_id,
    userId: reader.user_id,
    role: "member",
  });

  let query = db
    .from("tasks")
    .select(
      "id,title,description,due_at,conversation_id,addr_street,addr_unit," +
        "addr_city,addr_state,addr_postal_code,updated_at," +
        "conversations(phone_number_id)",
    )
    .eq("company_id", reader.company_id)
    .eq("assigned_user_id", reader.user_id)
    .is("deleted_at", null)
    .not("due_at", "is", null)
    // Bounded rather than unpaginated: a calendar showing five years of history
    // is slower to sync and no more useful than one showing the working window.
    .gte("due_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
    .order("due_at", { ascending: true })
    .limit(1000);

  const hidden = access.hiddenNumberIds;
  if (hidden !== null && hidden.length > 0) {
    // A task with no conversation is on no line, so it is not on a denied one.
    query = query.or(
      `phone_number_id.is.null,phone_number_id.not.in.(${hidden.join(",")})`,
      { referencedTable: "conversations" },
    );
  }

  const { data: taskRows, error: taskError } = await query;
  if (taskError) {
    console.error(`calendar feed tasks failed: ${taskError.message}`);
    return notFound();
  }

  const origin = env.APP_ORIGIN;
  const events: IcsEvent[] = ((taskRows ?? []) as unknown as FeedTask[]).map(
    (task) => {
    const start = new Date(task.due_at);
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
      description: task.description || undefined,
      location: addressOf(task),
      url: task.conversation_id
        ? `${origin}/inbox/${task.conversation_id}`
        : undefined,
      };
    },
  );

  const body = buildIcs({
    name: `${businessName} — my schedule`,
    events,
  });

  return c.body(body, 200, {
    "content-type": "text/calendar; charset=utf-8",
    // Short, because a revoke has to bite. Clients poll on their own schedule
    // anyway; this only bounds how long a revoked feed could still be served
    // from somebody's cache.
    "cache-control": "private, max-age=60",
    "content-disposition": 'inline; filename="schedule.ics"',
  });
});
