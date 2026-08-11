import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

/**
 * Phone display formatting (G10): numbers render `(416) 555-0182`,
 * E.164 stays under the hood, always.
 *
 * The GROUPING is not translated and must not be: NANP numbers are written
 * `(416) 555-0182` in Quebec exactly as they are in Ohio, and a reader
 * comparing what is on screen against what is on a truck needs the same shape.
 */
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!match) return e164;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}

/**
 * Contact display name: name when present, formatted number otherwise (G4).
 *
 * The one word here is the case where there is NEITHER — every list row in the
 * product renders through this, so it is one of the few strings a French reader
 * would meet on every screen at once.
 */
export function contactDisplayName(
  contact: { name: string | null; phone_e164: string } | null | undefined,
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string {
  if (!contact) return t("misc.unknownContact");
  return contact.name?.trim() ? contact.name : formatPhone(contact.phone_e164);
}
