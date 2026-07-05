/**
 * Phone normalization for contact input paths (SPEC §5, §7, §10).
 *
 * `POST /v1/contacts` and the CSV import accept human-formatted North American
 * numbers — "(416) 555-0199", "1-416-555-0199", "+14165550199" — and persist
 * strict E.164. The result must be an assigned US/CA area code per the shared
 * NANP table (SPEC §10 layer 2: `+1` alone is never enough — Caribbean NANP
 * codes are billed internationally and are the classic SMS-pumping target).
 */
import { isUsCaDestination } from "@loonext/shared";

/**
 * Normalize free-form input to `+1NXXNXXXXXX` and validate it against the
 * shared US/CA NANP table. Returns the E.164 string, or null when the input
 * is not a valid US/CA number.
 */
export function normalizeNanpPhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // Reject non-+1 international prefixes outright ("+44…" must not normalize).
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return null;

  const digits = trimmed.replace(/\D/g, "");
  let national: string;
  if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    national = digits.slice(1);
  } else {
    return null;
  }

  const e164 = `+1${national}`;
  return isUsCaDestination(e164) ? e164 : null;
}
