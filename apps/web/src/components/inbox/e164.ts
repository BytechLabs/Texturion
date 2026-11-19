import { lookupAreaCode } from "@loonext/shared";

export { normalizeNanpInput } from "@loonext/shared";

/** Format a partial NANP entry, preserving input that needs correction. */
export function formatNanpAsYouType(raw: string): string {
  const trimmed = raw.trim();
  if (!/^\+?[\d\s().-]*$/.test(trimmed) || (trimmed.startsWith("+") && !trimmed.startsWith("+1"))) {
    return raw;
  }
  let digits = trimmed.replaceAll(/\D/g, "");
  if (trimmed.startsWith("+1") || (digits.length === 11 && digits.startsWith("1"))) {
    digits = digits.slice(1);
  }
  if (digits.length > 10) return raw;
  if (digits.length === 0) return trimmed.startsWith("+") ? raw : "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** True when the input contains any digit (the field is a number, not a name). */
export function looksLikePhoneInput(raw: string): boolean {
  return /\d/.test(raw) && !/[a-z]/i.test(raw);
}

/**
 * The recipient's local wall clock: the label to show, and the hour to judge it
 * by. Null for non-geographic codes, where we genuinely do not know.
 *
 * #225: the composer needs BOTH. Showing the time without the hour meant web
 * could only mention it inside the quiet-hours dialog, after the send was
 * already refused — so the one moment a dispatcher could have chosen to wait
 * came with no information, while both phone apps had shown it all along.
 *
 * `quiet` is the CONSERVATIVE 8pm–8am window, deliberately not the per-state
 * rule. `destination-clock.ts` on the server is the file that decides, and it
 * knows things this cannot (Texas opens at noon on a Sunday). So a false calm
 * is possible here and is handled by never promising anything: the calm copy
 * states the time and nothing else, and the server still asks.
 */
export const QUIET_HOURS_START = 20;
export const QUIET_HOURS_END = 8;

export function destinationLocalClock(
  e164: string,
  now: Date = new Date(),
  locale = "en-US",
): { label: string; hour: number; quiet: boolean } | null {
  const entry = lookupAreaCode(e164);
  if (!entry || !entry.geographic) return null;
  try {
    const label = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: entry.timezone,
    }).format(now);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: entry.timezone,
      }).format(now),
    );
    if (!Number.isFinite(hour)) return null;
    // hour12:false renders midnight as 24 in some ICU versions.
    const normalized = hour === 24 ? 0 : hour;
    return {
      label,
      hour: normalized,
      quiet: normalized >= QUIET_HOURS_START || normalized < QUIET_HOURS_END,
    };
  } catch {
    return null;
  }
}

/**
 * The destination's local wall-clock time for the quiet-hours dialog copy
 * ("It's 9:14 PM for this customer" — G5). Null for non-geographic codes.
 */
export function destinationLocalTimeLabel(
  e164: string,
  now: Date = new Date(),
  locale = "en-US",
): string | null {
  return destinationLocalClock(e164, now, locale)?.label ?? null;
}
