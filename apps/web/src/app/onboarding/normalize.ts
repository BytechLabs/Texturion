import { isUsCaDestination } from "@jobtext/shared";

/**
 * Input normalizers for the identity step (G10: formatted for humans,
 * canonical under the hood). Pure — unit-tested alongside the step machine.
 */

/** "mikesplumbing.com" → "https://mikesplumbing.com"; empty stays empty. */
export function normalizeWebsite(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * "(416) 555-0182" / "416-555-0182" / "+1 416 555 0182" → "+14165550182".
 * Returns null unless the result is a real US/CA destination (the API's
 * sole-prop mobile check — isUsCaDestination — is authoritative).
 */
export function normalizeNanpPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let e164: string;
  if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return null;
  return isUsCaDestination(e164) ? e164 : null;
}
