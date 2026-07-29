import { lookupAreaCode, isUsCaDestination } from "@loonext/shared";

/**
 * Live E.164 handling for the compose recipient field (G5): the user types
 * anything — digits, "(416) 555…", "+1 416…" — the field renders
 * `(416) 555-0182` as they type (G10 display format), and E.164 stays under
 * the hood. Mirrors the API's normalizeNanpPhone contract: only assigned
 * US/CA NANP area codes are valid destinations (SPEC §10 layer 2).
 */

/** The national 10 digits typed so far (country prefix stripped), max 10. */
export function nationalDigits(raw: string): string {
  const hasPlusOne = raw.trim().startsWith("+1");
  let digits = raw.replace(/\D/g, "");
  if (hasPlusOne || (digits.length === 11 && digits.startsWith("1"))) {
    digits = digits.startsWith("1") ? digits.slice(1) : digits;
  }
  return digits.slice(0, 10);
}

/** Format-as-you-type: `4165` → `(416) 5`, full → `(416) 555-0182`. */
export function formatNanpAsYouType(raw: string): string {
  const digits = nationalDigits(raw);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Strict E.164 for submission: `+1NXXNXXXXXX` validated against the shared
 * NANP table, or null while incomplete/invalid (Caribbean +1 codes fail —
 * they bill internationally).
 */
export function normalizeNanpInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return null;
  const digits = nationalDigits(trimmed);
  if (digits.length !== 10) return null;
  const e164 = `+1${digits}`;
  return isUsCaDestination(e164) ? e164 : null;
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
): { label: string; hour: number; quiet: boolean } | null {
  const entry = lookupAreaCode(e164);
  if (!entry || !entry.geographic) return null;
  try {
    const label = new Intl.DateTimeFormat("en-US", {
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
): string | null {
  return destinationLocalClock(e164, now)?.label ?? null;
}
