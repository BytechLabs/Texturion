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
  /** 0–23 at the destination, at the instant asked about. */
  localHour: number;
  /** True between 8pm and 8am there. */
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

  const override =
    input.contactTimezone !== undefined
      ? input.contactTimezone
      : await lookupContactTimezone(db, input.companyId, input.phoneE164);
  if (override) return at(override, "contact", atUtc);

  const entry = lookupAreaCode(input.phoneE164);
  if (entry?.geographic && entry.timezone) {
    return at(entry.timezone, "area_code", atUtc);
  }

  const company =
    input.companyTimezone ?? (await lookupCompanyTimezone(db, input.companyId));
  return at(company, "company", atUtc);
}

function at(timezone: string, source: ClockSource, atUtc: Date): DestinationClock {
  const localHour = localHourIn(timezone, atUtc);
  return { timezone, source, localHour, quiet: isQuietHour(localHour) };
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
  fromUtc: Date,
): Date | null {
  if (!isQuietHour(localHourIn(timezone, fromUtc))) return null;

  // A whole day of hours is more than enough to walk out of a 12-hour quiet
  // window from anywhere inside it, and it is a hard stop rather than a
  // `while (true)` against a runtime we do not control.
  const cursor = new Date(fromUtc.getTime());
  cursor.setUTCMinutes(0, 0, 0);
  for (let step = 0; step < 26; step += 1) {
    cursor.setUTCHours(cursor.getUTCHours() + 1);
    if (localHourIn(timezone, cursor) !== QUIET_HOURS_END) continue;
    // Landed in the 8 o'clock hour, not necessarily on it. Newfoundland is
    // UTC-3:30, so its 08:00 falls at :30 past a UTC hour — stepping whole UTC
    // hours alone would report 08:30 and text half an hour late every day, not
    // twice a year.
    cursor.setUTCMinutes(cursor.getUTCMinutes() - localMinuteIn(timezone, cursor));
    return new Date(cursor);
  }
  // Unreachable for any real IANA zone: every one of them has an 8am each day.
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
