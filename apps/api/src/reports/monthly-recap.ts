import { formatResponseTime } from "@loonext/shared";

import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/**
 * #482 / #239 — the monthly recap the owner actually reads.
 *
 * The arc is the most repeatable thing this product knows about itself: how
 * fast a crew answers a new customer, and whether that is moving. An owner who
 * only sees it when they open the app sees it less often than they should.
 *
 * # What makes this different from another view of the same data
 *
 * It is a SEND. That means its own copy, its own opt-out, and its own cost
 * centre, and each of those is a way to get it wrong that a screen does not
 * have.
 *
 * # The three guards, and why each exists
 *
 * NO INVENTED ARC. A workspace with no baseline — too new, or nothing answered
 * in its first fortnight — gets nothing. #239 refused to draw that arc in the
 * UI, and an email is a worse place to invent one: a screen can be closed and
 * an email is a claim somebody keeps.
 *
 * BOTH DIRECTIONS. A crew that got slower still gets told. The panel does not
 * hide the wrong direction and neither does this; a recap that only ever
 * congratulates is an advertisement, and people stop reading advertisements.
 *
 * CAPPED BEFORE IT IS PROMPTED. Email costs money per send, and this one goes
 * to every eligible workspace at once — the shape most likely to surprise
 * somebody with a bill. `MAX_RECAPS_PER_RUN` bounds one run; past it the rest
 * are skipped, loudly, and simply arrive next month. Skipping is safe because
 * the recap is a courtesy, not a notification somebody is waiting on.
 *
 * # Who gets it
 *
 * The owner, and only the owner. It is a business-shape number rather than an
 * operational one — a tech answering texts cannot act on a monthly median, and
 * the person who can is the one deciding whether to hire.
 *
 * Filtered on `notification_prefs.email_enabled`, which is the opt-out this
 * product already has. Inventing a second unsubscribe would mean an owner who
 * turned email off still hearing from us, which is the only outcome that
 * matters here.
 */

/** The window each recap covers. */
export const RECAP_WINDOW_DAYS = 30;

/**
 * How many recaps one run may send.
 *
 * Chosen to be well above today's tenant count and well below anything that
 * could surprise us: a run that wants to exceed it says so in the logs, which
 * is the alert-before-the-cap shape the rest of this product uses. Whatever is
 * skipped is not lost — the next month's run sees the same workspaces.
 */
export const MAX_RECAPS_PER_RUN = 500;

/**
 * A median has to move by more than this to be called a change.
 *
 * Without it, a workspace whose median wobbled by two seconds would be told it
 * had "improved", which is noise dressed as an insight and the fastest way to
 * teach somebody that this email means nothing. Ten percent is the smallest
 * move a person would recognise as real on a number like this.
 */
export const MEANINGFUL_CHANGE_RATIO = 0.1;

interface RecapStats {
  leads: number;
  answered: number;
  unanswered: number;
  median_seconds: number | null;
}

export type RecapDirection = "faster" | "slower" | "steady";

/** Which way it moved, if it moved at all. Pure — tested directly. */
export function recapDirection(
  current: number | null,
  baseline: number | null,
): RecapDirection | null {
  // No arc to draw. The caller does not send at all in this case; returning
  // null rather than "steady" keeps "we have nothing to say" distinct from
  // "nothing changed", which are different emails.
  if (current === null || baseline === null || baseline <= 0) return null;
  const delta = baseline - current;
  if (Math.abs(delta) < baseline * MEANINGFUL_CHANGE_RATIO) return "steady";
  return delta > 0 ? "faster" : "slower";
}

/**
 * The whole email, as text.
 *
 * Pure so the copy can be asserted without a mailbox — the copy IS the feature
 * here, and the thing most likely to drift into congratulation.
 */
export function recapText(input: {
  companyName: string;
  current: RecapStats;
  baselineMedian: number | null;
}): string {
  const { companyName, current, baselineMedian } = input;
  const median = formatResponseTime(current.median_seconds);
  const direction = recapDirection(current.median_seconds, baselineMedian);

  let arc: string;
  switch (direction) {
    case "faster":
      arc =
        `That is faster than when you started, which was ` +
        `${formatResponseTime(baselineMedian)}.`;
      break;
    case "slower":
      // Said plainly, and without a scold. The owner knows their month was
      // busy; what they need is the number, not our opinion of it.
      arc =
        `That is slower than when you started, which was ` +
        `${formatResponseTime(baselineMedian)}.`;
      break;
    default:
      arc = `That is about the same as when you started.`;
  }

  let out = `${companyName} answered a new customer in ${median} on average `;
  out += `over the last ${RECAP_WINDOW_DAYS} days.\n\n${arc}\n\n`;

  // The leak, named. A workspace can improve this median by ignoring more
  // leads, so a recap that reported only the median would reward exactly the
  // behaviour it exists to discourage.
  if (current.unanswered > 0) {
    out +=
      `${current.unanswered} of ${current.leads} new ` +
      `customer${current.leads === 1 ? "" : "s"} never got an answer.\n\n`;
  }

  out += `You can see the detail, and the split between business hours and `;
  out += `after hours, on your home screen.\n\n`;
  out += `To stop these, turn email off in Settings → Notifications.`;
  return out;
}

interface OwnerRow {
  company_id: string;
  user_id: string;
}

/**
 * Send one month's recap to every workspace that has an arc worth reporting.
 *
 * Never throws for one workspace's sake: a company whose stats fail is skipped
 * and the run continues. A monthly job that dies on its ninth tenant has sent
 * eight recaps and hidden the reason.
 */
export async function runResponseTimeRecapJob(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  const until = now;
  const since = new Date(
    now.getTime() - RECAP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const { data: companies, error } = await db
    .from("companies")
    .select("id,name,created_at")
    .eq("subscription_status", "active")
    .not("plan", "is", null)
    .is("deleted_at", null);
  if (error) throw new Error(`recap company list failed: ${error.message}`);

  let sent = 0;
  let skippedForCap = 0;

  for (const row of (companies ?? []) as {
    id: string;
    name: string;
    created_at: string;
  }[]) {
    if (sent >= MAX_RECAPS_PER_RUN) {
      skippedForCap += 1;
      continue;
    }

    // No baseline, no email. The workspace has not been here long enough for
    // "when you started" to mean anything, and #239's rule is that we do not
    // invent that number.
    const baselineUntil = new Date(
      new Date(row.created_at).getTime() + 14 * 24 * 60 * 60 * 1000,
    );
    if (baselineUntil > until) continue;

    const current = await stats(db, row.id, since, until);
    const baseline = await stats(
      db,
      row.id,
      new Date(row.created_at),
      baselineUntil,
    );
    if (!current || !baseline) continue;

    // `no_answered_leads`: the other half of #239's rule. Nothing was answered
    // in the first fortnight, so there is no starting point to compare against.
    if (recapDirection(current.median_seconds, baseline.median_seconds) === null) {
      continue;
    }

    const owner = await ownerEmail(db, row.id);
    if (!owner) continue;

    await sendEmail(env, {
      to: [owner],
      subject: `${row.name}: how fast you answered this month`,
      text: recapText({
        companyName: row.name,
        current,
        baselineMedian: baseline.median_seconds,
      }),
      html: renderEmailHtml(
        recapText({
          companyName: row.name,
          current,
          baselineMedian: baseline.median_seconds,
        }),
      ),
    });
    sent += 1;
  }

  if (skippedForCap > 0) {
    // Loud, per the cost-protection posture: a cap that silently drops work
    // reads as "everybody got one". These arrive next month.
    console.warn(
      `response-time recap: sent ${sent} (the per-run ceiling of ` +
        `${MAX_RECAPS_PER_RUN}); ${skippedForCap} workspaces were skipped and ` +
        `will be picked up by the next run.`,
    );
  }
}

/** The same RPC the panel reads, so the two can never disagree. */
async function stats(
  db: ReturnType<typeof getDb>,
  companyId: string,
  from: Date,
  to: Date,
): Promise<RecapStats | null> {
  const { data, error } = await db.rpc("api_response_time_stats", {
    p_company_id: companyId,
    p_since: from.toISOString(),
    p_until: to.toISOString(),
    p_max_rows: 5000,
    /**
     * #581/#106 — null, and stated rather than omitted.
     *
     * This recap is addressed to the OWNER (see `recipient` below), and
     * `resolveNumberAccess` short-circuits owners and admins to unrestricted, so
     * resolving it here would compute null and cost a query to do it. Null is the
     * right answer.
     *
     * Written out anyway because the roster in
     * `auth/number-access-surfaces.test.ts` requires every call site of a
     * filtered RPC to name this parameter — the omission and the decision look
     * identical in a diff otherwise, and a defaulted parameter filters against
     * null perfectly happily while hiding nothing. If this recap is ever
     * addressed to anybody but the owner, this line is the one to change.
     */
    p_hidden_number_ids: null,
  });
  if (error) return null;
  return data as RecapStats;
}

/** The owner's address, unless they have turned email off. */
async function ownerEmail(
  db: ReturnType<typeof getDb>,
  companyId: string,
): Promise<string | null> {
  const { data: members, error } = await db
    .from("company_members")
    .select("company_id,user_id")
    .eq("company_id", companyId)
    .eq("role", "owner")
    .is("deactivated_at", null)
    .limit(1);
  if (error || !members?.length) return null;
  const owner = members[0] as OwnerRow;

  const { data: prefs } = await db
    .from("notification_prefs")
    .select("email_enabled")
    .eq("company_id", companyId)
    .eq("user_id", owner.user_id)
    .limit(1);
  // Absent prefs mean the default, which is on — the column defaults true and
  // a row is only written when somebody changes something.
  if (prefs?.length && (prefs[0] as { email_enabled: boolean }).email_enabled === false) {
    return null;
  }

  const { data: user } = await db.auth.admin.getUserById(owner.user_id);
  return user?.user?.email ?? null;
}
