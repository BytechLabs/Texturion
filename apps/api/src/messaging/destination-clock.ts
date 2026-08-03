/**
 * #292 / D49 — what time it is where the customer is, and whether we may text
 * them right now.
 *
 * Quiet hours are destination-local (D4), and until now that answer was
 * derived inline on the compose path from the area code alone. Two problems,
 * both of which only bite when nobody is watching the send go out:
 *
 *   **Area codes lie.** A mobile number keeps its original code when its owner
 *   moves provinces. A dispatcher who knows better had no way to say so, and
 *   every future send re-derived the same wrong answer.
 *
 *   **Automated paths do not go through compose.** Send later (#233),
 *   reminders (#237) and post-job ratings (#313) each fire from somewhere
 *   else, at a time nobody chose by hand. A path that simply never asks
 *   produces a text at 3am with no error anywhere — the silent failure this
 *   module exists to make impossible.
 *
 * SO THERE IS ONE RESOLVER, and it is the only one. The compose gate uses it
 * too, so there is a single implementation to be right rather than two to keep
 * in agreement, and `destination-clock.test.ts` enumerates the files allowed
 * to decide quiet hours at all.
 *
 * RESOLVE AT FIRE TIME, NOT AT SCHEDULE TIME. A message queued at noon and
 * sent at 11pm was checked against the wrong instant, and DST means even the
 * same wall-clock time can be a different hour eight weeks later.
 */
import { localHourInZone, lookupAreaCode } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SPEC §5 / D4: 8pm–8am destination local time is quiet. Half-open on both
 * ends — 08:00 is allowed, 20:00 is not.
 */
export const QUIET_HOURS_START = 20;
export const QUIET_HOURS_END = 8;

/** Which rung of the D49 ladder produced the answer. */
export type ClockSource =
  /** A person corrected it on the contact. */
  | "contact"
  /** Inferred from the destination's area code. */
  | "area_code"
  /** Neither was available, so the shop's own clock stands in. */
  | "company";

export interface DestinationClock {
  timezone: string;
  source: ClockSource;
  /**
   * #225: the destination's state/province, from the area code, or null when
   * the number is non-geographic. Carried separately from the timezone
   * because the quiet-hours WINDOW is a matter of state law while the clock is
   * a matter of geography, and Texas proves they are not the same question.
   */
  region: string | null;
  /** 0–23 at the destination, at the instant asked about. */
  localHour: number;
  /** True inside the destination's quiet window — see `isQuietAt`. */
  quiet: boolean;
}

/**
 * Local hour in a zone, via the shared primitive (which asks the runtime's
 * tzdata, so DST is never our arithmetic). A zone the runtime rejects reads as
 * hour 0 rather than throwing: the column is constrained and API-validated, so
 * this only fires if tzdata drops a zone underneath a stored value — and a
 * send that treats an impossible zone as the middle of the night is the
 * failure worth having.
 */
function localHourIn(timezone: string, atUtc: Date): number {
  return localHourInZone(timezone, atUtc) ?? 0;
}

/** 8pm–8am there. Exported so the compose gate asks rather than re-derives. */
export function isQuietHour(hour: number): boolean {
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

/**
 * #225 — the per-state exceptions, and why there is exactly one.
 *
 * The federal TCPA baseline is 8am–9pm local. Florida, Connecticut, Maryland,
 * Oklahoma and Washington cut the evening at 8pm, and Texas runs 9am–9pm
 * Monday to Saturday and NOON–9pm on Sunday.
 *
 * Our single window is already 8am–8pm, which is stricter than every one of
 * those on both ends — with one exception. TEXAS ON A SUNDAY opens at noon,
 * so an 8am start is four hours LOOSER than the law there. That is the only
 * gap in the list the issue names, and it is the only entry in this table.
 *
 * The table is deliberately narrowing-only: an entry may make the window
 * tighter, never wider. A state list that could loosen the baseline would turn
 * a data-entry slip into a violation, and the whole value of a conservative
 * default is that nothing can quietly erode it.
 *
 * NOT LEGAL ADVICE, and the code should not pretend otherwise: this encodes
 * the state list from #225 and wants a lawyer's review before anybody treats
 * it as complete. What it does buy is that the strictest rule we know about is
 * the one that applies.
 */
export function quietOpenHourFor(
  region: string | null | undefined,
  weekday: number,
): number {
  // 0 = Sunday, matching Date#getDay and Intl's ordering.
  if (region === "TX" && weekday === 0) return 12;
  return QUIET_HOURS_END;
}

/**
 * Is it quiet at the destination right now, accounting for the state?
 *
 * Takes the instant rather than an hour, because the day of the week is part
 * of the answer and an hour alone cannot carry it — which is exactly the shape
 * of the bug this closes.
 */
export function isQuietAt(
  timezone: string,
  region: string | null | undefined,
  atUtc: Date,
): boolean {
  const hour = localHourIn(timezone, atUtc);
  const weekday = localWeekdayIn(timezone, atUtc);
  return hour >= QUIET_HOURS_START || hour < quietOpenHourFor(region, weekday);
}

/**
 * Day of the week AT THE DESTINATION, 0 = Sunday.
 *
 * Asked of the runtime rather than derived from an offset: a Sunday in Texas
 * begins and ends at different UTC instants than a Sunday here, and the only
 * send this rule exists to stop sits right on that boundary.
 */
function localWeekdayIn(timezone: string, atUtc: Date): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(atUtc);
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
  // An unknown zone reads as Sunday, the STRICTEST day in the table. Failing
  // toward the narrower window is the only safe direction here.
  return index === -1 ? 0 : index;
}

export interface ResolveInput {
  companyId: string;
  /** E.164 destination. The area-code rung reads this. */
  phoneE164: string;
  /** When to ask about. Callers pass the FIRE instant, never the queue one. */
  atUtc?: Date;
  /**
   * The contact's stored override, when the caller already has it. Passing it
   * skips a query; omitting it makes one. `undefined` means "look it up",
   * `null` means "there is none" — the distinction matters, because a caller
   * that already knows there is no override should not pay for a round trip
   * to be told so again.
   */
  contactTimezone?: string | null;
  /** Same, for the company's own zone. */
  companyTimezone?: string;
}

/**
 * The D49 ladder: contact override → area code → the shop's clock.
 *
 * It cannot fail to produce an answer, which is the point. The old shape
 * returned null for a non-geographic area code and every caller had to invent
 * a policy for it; the compose path chose "no dialog", which is right for a
 * person pressing send and wrong for a cron. Falling back to the company's
 * timezone gives an automated path something defensible to act on, and the
 * `source` tells any screen how much to trust it.
 */
export async function resolveDestinationClock(
  db: SupabaseClient,
  input: ResolveInput,
): Promise<DestinationClock> {
  const atUtc = input.atUtc ?? new Date();

  const entry = lookupAreaCode(input.phoneE164);
  // #225: the STATE comes from the number, always — never from whichever rung
  // supplied the timezone. The law keys on where the recipient is, and a
  // dispatcher correcting a timezone is telling us what o'clock it is there,
  // not which state's legislature they answer to.
  const region = entry?.geographic ? (entry.region ?? null) : null;

  const override =
    input.contactTimezone !== undefined
      ? input.contactTimezone
      : await lookupContactTimezone(db, input.companyId, input.phoneE164);
  if (override) return at(override, "contact", region, atUtc);

  if (entry?.geographic && entry.timezone) {
    return at(entry.timezone, "area_code", region, atUtc);
  }

  const company =
    input.companyTimezone ?? (await lookupCompanyTimezone(db, input.companyId));
  return at(company, "company", region, atUtc);
}

function at(
  timezone: string,
  source: ClockSource,
  region: string | null,
  atUtc: Date,
): DestinationClock {
  const localHour = localHourIn(timezone, atUtc);
  return {
    timezone,
    source,
    region,
    localHour,
    quiet: isQuietAt(timezone, region, atUtc),
  };
}

/**
 * The override for a number, if a person set one. Read by phone rather than by
 * contact id because a send knows the destination for certain and may not have
 * loaded a contact — and because two contact rows for the same number would
 * otherwise be able to disagree about what time it is there.
 */
async function lookupContactTimezone(
  db: SupabaseClient,
  companyId: string,
  phoneE164: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("contacts")
    .select("timezone")
    .eq("company_id", companyId)
    .eq("phone_e164", phoneE164)
    .not("timezone", "is", null)
    .limit(1);
  if (error) throw new Error(`contact timezone lookup failed: ${error.message}`);
  return ((data ?? [])[0] as { timezone?: string } | undefined)?.timezone ?? null;
}

async function lookupCompanyTimezone(
  db: SupabaseClient,
  companyId: string,
): Promise<string> {
  const { data, error } = await db
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .limit(1);
  if (error) throw new Error(`company timezone lookup failed: ${error.message}`);
  // NOT NULL with a default since D15, so this only stands in for a row that
  // vanished mid-request — and a fallback that is a real zone beats one that
  // throws inside a send.
  return (
    ((data ?? [])[0] as { timezone?: string } | undefined)?.timezone ??
    "America/Toronto"
  );
}

/**
 * The next instant it is 8am at the destination, when it is currently quiet
 * there. Null when it is not quiet — the send may go now.
 *
 * This is what a deferring path needs (#233, #237, #313): "not yet" is useless
 * without "then". Computed by stepping forward an hour at a time and asking
 * the zone what hour it is, rather than by adding an offset, because the two
 * days a year that matter are exactly the ones offset arithmetic gets wrong —
 * the morning that skips 2am, and the one that has 1am twice.
 */
export function nextSendableInstant(
  timezone: string,
  region: string | null,
  fromUtc: Date,
): Date | null {
  if (!isQuietAt(timezone, region, fromUtc)) return null;

  // A whole day of hours is more than enough to walk out of a 12-hour quiet
  // window from anywhere inside it, and it is a hard stop rather than a
  // `while (true)` against a runtime we do not control.
  const cursor = new Date(fromUtc.getTime());
  cursor.setUTCMinutes(0, 0, 0);
  for (let step = 0; step < 26; step += 1) {
    cursor.setUTCHours(cursor.getUTCHours() + 1);
    // #225: ask the WINDOW, not a fixed hour. Targeting 8 o'clock directly
    // would release a held Texas message at 8am on a Sunday — four hours
    // inside the prohibition it was held for, which is worse than not holding
    // it at all, because now we did it deliberately.
    if (isQuietAt(timezone, region, cursor)) continue;
    // Landed in the opening hour, not necessarily on it. Newfoundland is
    // UTC-3:30, so its 08:00 falls at :30 past a UTC hour — stepping whole UTC
    // hours alone would report 08:30 and text half an hour late every day, not
    // twice a year.
    cursor.setUTCMinutes(cursor.getUTCMinutes() - localMinuteIn(timezone, cursor));
    return new Date(cursor);
  }
  // Unreachable for any real IANA zone: every one of them leaves its quiet
  // window at some point in any 26-hour span.
  return null;
}

/**
 * The last instant before `atUtc` that is NOT quiet at the destination, or
 * `atUtc` itself when it was already fine.
 *
 * THE MIRROR OF `nextSendableInstant`, AND THE DIRECTION MATTERS. Deferring a
 * message forward to 8am is right when the message has no deadline — a
 * follow-up, a held send. An appointment reminder has one: the appointment. A
 * 2-hour reminder for a 7am job computes to 5am, and walking FORWARD out of the
 * quiet window lands it at 8am — an hour after the van arrived, which is worse
 * than not sending it. Walking back lands it at 7pm the evening before: earlier
 * than intended, still before the job, and legal.
 *
 * Returning null is impossible for a real IANA zone for the same reason
 * `nextSendableInstant` says so; the bound is a hard stop rather than a
 * `while (true)` against a runtime we do not control. A caller that gets null
 * should not send.
 */
export function lastSendableInstantBefore(
  timezone: string,
  region: string | null,
  atUtc: Date,
): Date | null {
  if (!isQuietAt(timezone, region, atUtc)) return atUtc;

  const cursor = new Date(atUtc.getTime());
  cursor.setUTCMinutes(0, 0, 0);
  for (let step = 0; step < 26; step += 1) {
    cursor.setUTCHours(cursor.getUTCHours() - 1);
    if (isQuietAt(timezone, region, cursor)) continue;
    // Landed in the last legal hour, not necessarily on it. Snapped to the top
    // of that local hour for the same Newfoundland reason as above — a zone
    // offset by :30 would otherwise report a time half an hour out.
    cursor.setUTCMinutes(cursor.getUTCMinutes() - localMinuteIn(timezone, cursor));
    return new Date(cursor);
  }
  return null;
}

/** Minutes past the local hour, for zones whose offset is not a whole hour. */
function localMinuteIn(timezone: string, atUtc: Date): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "numeric",
  })
    .formatToParts(atUtc)
    .find((p) => p.type === "minute");
  return part ? Number(part.value) : 0;
}
