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
 * The destination's local wall-clock time for the quiet-hours dialog copy
 * ("It's 9:14 PM for this customer" — G5). Null for non-geographic codes.
 */
export function destinationLocalTimeLabel(
  e164: string,
  now: Date = new Date(),
): string | null {
  const entry = lookupAreaCode(e164);
  if (!entry || !entry.geographic) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: entry.timezone,
    }).format(now);
  } catch {
    return null;
  }
}
