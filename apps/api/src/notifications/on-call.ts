/**
 * #244 — who a page actually goes to after hours.
 *
 * One resolver, called by every fan-out that can wake somebody at night. It
 * takes the audience that would have been notified and either hands it back
 * unchanged or narrows it to the person holding the phone.
 *
 * EVERY UNCERTAINTY WIDENS. That is the single rule this file is built on, and
 * it decides every branch below: no business hours configured, an unresolvable
 * timezone, nobody on call, an on-call member who cannot see the thread, a read
 * that failed. All of them return the full audience, because the two mistakes
 * are not symmetrical — waking four people who did not need to be woken is a
 * bad night, and waking nobody is a customer who calls a competitor and a
 * business that never learns why.
 *
 * It is also why narrowing is only ever applied AFTER HOURS. During the working
 * day the whole crew seeing a missed call is not noise, it is coverage; the
 * problem this solves is specifically 11:40pm on a Saturday.
 *
 * NOT #225. Quiet hours govern outbound messages to customers and are a legal
 * send window. This governs alerts to our own users, who have an employment
 * relationship with the workspace and can agree to be woken. Nothing here is
 * ever read by the send path, and nothing in #225 narrows who gets paged.
 */
import { isAfterHours, type BusinessHours, type HoursException } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OnCallRouting {
  /** Who to notify now. The input audience, or one person. */
  userIds: string[];
  /**
   * The escalation row, when this page was narrowed. Null when everybody was
   * notified — there is nobody left to widen to, so there is nothing to track.
   *
   * Callers put it in the push payload so the notification can carry an
   * Acknowledge action.
   */
  alertId: string | null;
  /** Why it came out this way, for the log line that explains a quiet night. */
  reason:
    | "narrowed"
    | "within_hours"
    | "nobody_on_call"
    | "on_call_cannot_see_thread"
    | "escalates_immediately"
    | "unknown_clock"
    /** A read failed. Widened, because silence is the worse failure. */
    | "lookup_failed";
}

interface CompanyClock {
  timezone: string | null;
  business_hours: BusinessHours | null;
  business_hours_exceptions: HoursException[] | null;
  on_call_escalate_after_minutes: number;
}

/**
 * Narrow an after-hours page to whoever is on call, or hand it back whole.
 *
 * `audience` is what the caller would have notified — already filtered by #106
 * access, because that filtering is not this function's job and doing it twice
 * is how the two copies disagree.
 */
export async function routeAfterHoursAlert(
  db: SupabaseClient,
  input: {
    companyId: string;
    conversationId: string;
    phoneNumberId: string | null;
    /** What woke somebody: 'missed_call', 'emergency', 'poor_rating'… */
    kind: string;
    audience: string[];
    now?: Date;
  },
): Promise<OnCallRouting> {
  const now = input.now ?? new Date();
  const whole: OnCallRouting = {
    userIds: input.audience,
    alertId: null,
    reason: "within_hours",
  };
  if (input.audience.length <= 1) return whole;

  // NOTHING IN HERE THROWS. A caller that catches and logs would end up
  // sending no push at all, which is the one outcome worse than waking
  // everybody — so a failed read is just another uncertainty, and every
  // uncertainty widens.
  const companyRead = await db
    .from("companies")
    .select(
      "timezone,business_hours,business_hours_exceptions," +
        "on_call_escalate_after_minutes",
    )
    .eq("id", input.companyId)
    .limit(1);
  if (companyRead.error) {
    console.error(`on-call company lookup failed: ${companyRead.error.message}`);
    return { ...whole, reason: "lookup_failed" };
  }
  const company = (companyRead.data as unknown as CompanyClock[] | null)?.[0];
  // No row, no timezone, no configured hours: we cannot say it is night, so we
  // do not get to decide somebody should sleep through this.
  if (!company?.timezone || !company.business_hours) {
    return { ...whole, reason: "unknown_clock" };
  }

  if (
    !isAfterHours(
      company.timezone,
      company.business_hours,
      now,
      company.business_hours_exceptions,
    )
  ) {
    return whole;
  }

  const onCallRead = await db.rpc("api_on_call_now", {
    p_company_id: input.companyId,
    p_phone_number_id: input.phoneNumberId,
    p_at: now.toISOString(),
  });
  if (onCallRead.error) {
    console.error(`on-call lookup failed: ${onCallRead.error.message}`);
    return { ...whole, reason: "lookup_failed" };
  }
  // NULL is an ANSWER here, not a missing value — "nobody is holding the
  // phone" is the commonest state in the product, since most crews will never
  // set a shift. `unwrap` treats a null scalar as a failure, which is right
  // for a row and wrong for this.
  const onCall = onCallRead.data as string | null;
  if (!onCall) return { ...whole, reason: "nobody_on_call" };

  // #106: on call for the workspace is not access to this thread. Paging
  // somebody who opens the app to a permission error is worse than waking the
  // team — they cannot act, and now nobody else knows.
  if (!input.audience.includes(onCall)) {
    return { ...whole, reason: "on_call_cannot_see_thread" };
  }

  // Zero minutes is a legitimate choice for a crew of two: it means "tell
  // everybody at once", which is the pre-#244 behaviour. Honour it by not
  // narrowing at all, rather than by narrowing and immediately widening —
  // which would page the on-call member twice for one call.
  if (company.on_call_escalate_after_minutes <= 0) {
    return { ...whole, reason: "escalates_immediately" };
  }

  const opened = await db
    .from("alert_escalations")
    .insert({
      company_id: input.companyId,
      conversation_id: input.conversationId,
      kind: input.kind,
      on_call_user_id: onCall,
      escalate_at: new Date(
        now.getTime() + company.on_call_escalate_after_minutes * 60_000,
      ).toISOString(),
    })
    .select("id");
  // No row means no safety net: the page would go to one person and, if they
  // slept through it, nothing would ever widen. Narrowing is only safe BECAUSE
  // the escalation exists, so without it we do not narrow.
  const alertId = (opened.data as unknown as { id: string }[] | null)?.[0]?.id;
  if (opened.error || !alertId) {
    console.error(
      `on-call escalation could not be opened, alerting everyone: ${
        opened.error?.message ?? "no row returned"
      }`,
    );
    return { ...whole, reason: "lookup_failed" };
  }

  return { userIds: [onCall], alertId, reason: "narrowed" };
}
