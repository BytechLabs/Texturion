/**
 * #297 — one notification a day, saying where things stand.
 *
 * "An owner does not want every event; they want to know how the day went —
 * what came in, what is still unanswered, what is due tomorrow. That is one
 * notification a day and it is probably the most-read thing we could send."
 *
 * THE NUMBERS COME FROM `api_for_you`, NOT FROM A SECOND SET OF COUNTS. That
 * RPC is what the home screen already renders, so the summary and the app can
 * never disagree — and a summary that said "3 waiting" over a screen showing 5
 * would destroy the credibility of both in one morning.
 *
 * IDEMPOTENT ON THE MEMBER'S OWN CALENDAR DAY. `summary_sent_on` stores their
 * LOCAL date: comparing instants would send a second summary to anybody whose
 * midnight falls differently from the server's, which is most of the customer
 * base.
 */
import { SUMMARY_TITLE, type Locale, summaryLine } from "@loonext/shared";

import { resolveNumberAccess } from "../auth/number-access";
import type { MemberRole } from "@loonext/shared";
import { getDb } from "../db";
import type { Env } from "../env";
import { deliverPush } from "./deliver";

/** How many members one tick will summarise. */
const MAX_PER_TICK = 50;

export interface DailySummarySummary {
  considered: number;
  sent: number;
}

interface SummaryRow {
  user_id: string;
  company_id: string;
  summary_at: string;
  summary_sent_on: string | null;
  quiet_timezone: string | null;
  companies: { timezone: string | null } | null;
}

/** The member's local date and minutes-since-midnight, or null. */
export function localClock(
  timezone: string,
  at: Date,
): { date: string; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value;
    const year = get("year");
    const month = get("month");
    const day = get("day");
    const hour = get("hour");
    const minute = get("minute");
    if (!year || !month || !day || hour === undefined || minute === undefined) {
      return null;
    }
    return {
      date: `${year}-${month}-${day}`,
      minutes: (Number(hour) % 24) * 60 + Number(minute),
    };
  } catch {
    return null;
  }
}

/** "07:30" as minutes since midnight, or null when it will not parse. */
function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Send the summary to everybody whose chosen time has arrived.
 *
 * Best-effort per member: one workspace's dead tokens must not stop the next
 * person's summary. A member whose row cannot be read or whose clock cannot be
 * resolved is SKIPPED rather than sent to — the opposite of the notification
 * paths' usual bias, and deliberately: this is a scheduled, optional courtesy,
 * and sending it at the wrong hour is worse than not sending it. It will go
 * tomorrow.
 */
export async function runDailySummary(
  env: Env,
  now = new Date(),
): Promise<DailySummarySummary> {
  const db = getDb(env);
  const summary: DailySummarySummary = { considered: 0, sent: 0 };

  const { data, error } = await db
    .from("notification_prefs")
    .select(
      "user_id,company_id,summary_at,summary_sent_on,quiet_timezone," +
        "companies(timezone)",
    )
    .not("summary_at", "is", null)
    .limit(MAX_PER_TICK);
  if (error) throw new Error(`daily summary lookup failed: ${error.message}`);

  const rows = (data ?? []) as unknown as SummaryRow[];
  summary.considered = rows.length;

  for (const row of rows) {
    try {
      const zone = row.quiet_timezone ?? row.companies?.timezone;
      if (!zone) continue;
      const clock = localClock(zone, now);
      const wanted = timeToMinutes(row.summary_at);
      if (!clock || wanted === null) continue;

      // Already gone today, in THEIR calendar.
      if (row.summary_sent_on === clock.date) continue;
      // Not yet their time.
      if (clock.minutes < wanted) continue;

      // Claim the day BEFORE sending. A push that fails leaves the day
      // claimed, which is the right trade: this is one optional notification,
      // and retrying it every fifteen minutes until a dead device comes back
      // would turn a courtesy into a nuisance.
      const claim = await db
        .from("notification_prefs")
        .update({ summary_sent_on: clock.date })
        .eq("user_id", row.user_id)
        .eq("company_id", row.company_id)
        .or(`summary_sent_on.is.null,summary_sent_on.neq.${clock.date}`)
        .select("user_id");
      if (claim.error || (claim.data ?? []).length === 0) continue;

      // #106: the counts must exclude numbers this member cannot see, or the
      // summary reports work they are not allowed to know exists. The role is
      // its own read because `notification_prefs` and `company_members` have
      // no foreign key between them, so PostgREST cannot embed one in the
      // other — the same limitation the satisfaction report hit with profiles.
      const members = await db
        .from("company_members")
        .select("role")
        .eq("company_id", row.company_id)
        .eq("user_id", row.user_id)
        .limit(1);
      const role = (members.data as { role: MemberRole }[] | null)?.[0]?.role;
      // No membership row means they left the workspace between the two reads.
      // Skipping is the only safe answer: `resolveNumberAccess` would need a
      // role to deny anything, and defaulting one would be inventing access.
      if (members.error || !role) continue;

      const access = await resolveNumberAccess(db, {
        companyId: row.company_id,
        userId: row.user_id,
        role,
      });

      const { data: forYou, error: forYouError } = await db.rpc("api_for_you", {
        p_company_id: row.company_id,
        p_user_id: row.user_id,
        p_now: now.toISOString(),
        p_limit: 1,
        p_hidden_number_ids: access.hiddenNumberIds,
      });
      if (forYouError) throw new Error(forYouError.message);

      const totals = (forYou as { totals?: Record<string, number> } | null)
        ?.totals;
      const counts = {
        waiting: totals?.waiting_on_you ?? 0,
        tasks: totals?.my_tasks ?? 0,
      };
      const url = `${env.APP_ORIGIN}/for-you`;
      // #228: composed PER READER. The counts come off one RPC and mean the
      // same thing in either language; the sentence that reports them does
      // not, and this is the notification most likely to be the only one
      // somebody reads all day.
      const summaryPush = (locale: Locale) => ({
        title: SUMMARY_TITLE[locale],
        body: summaryLine(counts, locale),
        url,
      });

      const failures: unknown[] = [];
      await deliverPush(env, db, {
        companyId: row.company_id,
        // The summary IS the quiet setting's output. Sending it under any
        // member-facing category would let the volume control silence the
        // thing a member turned the volume control on to receive.
        category: "operational",
        failures,
        userIds: [row.user_id],
        // #430: a count, not content. The whole point of a summary is that it
        // says how much without saying what.
        content: { written: "us" },
        collapseKey: `summary:${row.user_id}`,
        web: summaryPush,
        native: (locale) => ({ kind: "summary", ...summaryPush(locale) }),
      });
      if (failures.length > 0) {
        console.error(
          `daily summary: ${failures.length} push(es) failed for ${row.user_id}`,
        );
      }
      summary.sent += 1;
    } catch (cause) {
      console.error(`daily summary: ${row.user_id} failed`, cause);
    }
  }

  return summary;
}
