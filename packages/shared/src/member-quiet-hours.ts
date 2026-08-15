/**
 * #244 — is this member's phone supposed to be quiet right now?
 *
 * NOT #225. That module decides whether the BUSINESS may text a CUSTOMER, and
 * it is law. This decides whether one of our own users wants to be disturbed,
 * and it is a preference they set for themselves. Nothing here may ever be
 * consulted by the send path, and nothing in #225 may decide whether a phone
 * rings.
 *
 * A ROUTINE push is suppressed. A page is not — that is the "emergency
 * override" the issue asks for, and it is what makes the window safe to turn
 * on: a member can silence the 1:40am customer text without also silencing the
 * night they are holding the phone.
 */

/** A member's window, as stored. Both halves or neither. */
export interface MemberQuietWindow {
  /** "22:00" — local wall clock in `timezone`. */
  from: string | null;
  /** "07:00" — exclusive, so a window ending at 07:00 lets 07:00 through. */
  to: string | null;
  /** The member's own zone; the caller falls back to the company's. */
  timezone: string | null;
}

/** Minutes since local midnight, or null when the value is not a time. */
function minutesOf(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** The member's local wall clock in minutes, or null if the zone is unusable. */
function localMinutes(timezone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    if (hour === undefined || minute === undefined) return null;
    // Intl can render midnight as "24" in some environments.
    return (Number(hour) % 24) * 60 + Number(minute);
  } catch {
    return null;
  }
}

/**
 * Should a ROUTINE push to this member be held back right now?
 *
 * False whenever we cannot answer confidently — no window, a malformed one, an
 * unusable timezone. THE UNCERTAIN DIRECTION IS TO NOTIFY, which is the
 * opposite of #225's bias and deliberately so: there, a wrong guess texts a
 * customer at 3am and is a regulatory problem; here, a wrong guess means a
 * member's phone buzzes when they wanted quiet, and the alternative is silently
 * withholding a message somebody was waiting for.
 */
export function isMemberQuietNow(
  window: MemberQuietWindow,
  fallbackTimezone: string | null,
  at: Date,
): boolean {
  if (!window.from || !window.to) return false;

  const zone = window.timezone ?? fallbackTimezone;
  if (!zone) return false;

  const from = minutesOf(window.from);
  const to = minutesOf(window.to);
  const now = localMinutes(zone, at);
  if (from === null || to === null || now === null) return false;

  // A zero-length window silences nothing. Somebody setting 22:00–22:00 has
  // expressed no preference, and reading it as "always quiet" would silence a
  // phone permanently on the strength of a typo.
  if (from === to) return false;

  // Overnight windows wrap: 22:00–07:00 is quiet at 23:00 AND at 02:00.
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/**
 * What the crew reads on the setting.
 *
 * THE REASSURANCE IS THE LOAD-BEARING SENTENCE. The reason people do not set
 * quiet hours is the fear of missing the emergency, so a control that offers
 * silence without saying what still gets through does not get switched on —
 * and the member goes back to turning notifications off entirely, which is the
 * failure this whole thing exists to prevent.
 */
/** Every catalogue key this module names. */
export type QuietHoursKey =
  | "domain.quietHoursHeading"
  | "domain.quietHoursReassurance"
  | "domain.quietHoursOff"
  | "domain.quietHoursOn"
  | "domain.quietHoursScope"
  | "domain.quietHoursLine";

/** The reader's resolver. */
export type SayQuietHours = (key: QuietHoursKey) => string;

export const QUIET_HOURS_COPY = {
  heading: "domain.quietHoursHeading",
  /** Said before they choose, not after. */
  reassurance: "domain.quietHoursReassurance",
  /** Off, which is every existing member. */
  off: "domain.quietHoursOff",
  /** On, with the window filled in by the caller. */
  on: "domain.quietHoursOn",
  /** Per workspace, because the preference is. */
  scope: "domain.quietHoursScope",
} as const;

/** The window most people want, offered rather than imposed. */
export const QUIET_HOURS_DEFAULT = { from: "22:00", to: "07:00" } as const;

/**
 * "Quiet from 10:00 PM to 7:00 AM" — assembled once, not three times.
 *
 * #228: a TEMPLATE key rather than the label plus " to ". The two are not the
 * same sentence in French and the difference is the preposition — the label is
 * "Silence à partir de" and the assembled line is "Silence de {from} à {to}".
 * Concatenating the label with a translated " to " would have produced
 * "Silence à partir de 22:00 à 07:00", which is wrong in a way an English
 * reader would never see. Android has had both keys for months.
 */
export function quietHoursLine(
  from: string,
  to: string,
  say: SayQuietHours,
): string {
  return say("domain.quietHoursLine")
    .replace("{from}", from)
    .replace("{to}", to);
}
