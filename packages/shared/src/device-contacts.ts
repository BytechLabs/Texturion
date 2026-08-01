/**
 * #459 — the phone's own address book, shown beside the crew's.
 *
 * # Why this is a separate list and not merged into the contacts table
 *
 * The Contacts tab is the crew's SHARED book: the people the workspace texts,
 * with history, tasks and opt-out state attached. A phone's personal address
 * book is a different thing — a dentist, a brother-in-law, four hundred numbers
 * nobody else on the crew has ever seen. Merging them would bury the shared book
 * under somebody's personal one, and the shared book is what the product is for.
 *
 * So the two render as two groups, and this module answers the only question
 * the clients share: given what somebody typed, which device contacts match?
 *
 * # Why the filter runs on the client
 *
 * These rows never leave the phone. Reading the address book is a permission
 * the person granted us for name-matching, not a licence to upload it — so
 * there is no server to ask, and the search has to be local. That also bounds
 * what this can cost: the list is capped, and a device book is already in
 * memory because the dialer loaded it.
 *
 * Hand-ported to Kotlin and Swift. Word splitting is explicit rather than
 * regex-based for the same reason `dialer.ts` gives: a word boundary escape is
 * a backspace character in Kotlin and does not compile in a Swift regex.
 */

import { nationalDigits } from "./dialer";

/** How many device rows a list shows before it says there are more. */
export const MAX_DEVICE_CONTACT_ROWS = 50;

/** Fewest characters before a device search runs. Below this, show the head. */
export const MIN_DEVICE_QUERY = 1;

/** One row as the clients hold it: a name, and the number to reach it on. */
export interface DeviceContactListRow {
  /** Stable per device book (Android's lookup key, iOS's identifier). */
  id: string;
  name: string;
  /** E.164 when the number is NANP, otherwise whatever the device stored. */
  number: string;
}

/**
 * True when a device row answers what somebody typed.
 *
 * Names match at WORD STARTS, the same rule the dialer uses: typing "sm" finds
 * "Dana Smith" and does not find "Kasm Roofing". Numbers match as a substring
 * of the digits, because a person searching by number is usually typing the
 * tail of one they half-remember.
 */
export function deviceContactMatches(row: DeviceContactListRow, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < MIN_DEVICE_QUERY) return true;

  const digits = trimmed.replace(/\D/g, "");
  // A query that is ONLY digits is a number search. Checking the name too
  // would match "A1 Plumbing" for "1", which is noise dressed as a result.
  if (digits.length > 0 && digits === trimmed) {
    return nationalDigits(row.number).includes(digits);
  }

  const name = row.name.toLowerCase();
  if (name.startsWith(trimmed)) return true;
  // Any later word: a surname is how people are found at least as often as a
  // first name, and "Roofing" has to find "Alaska Roofing".
  for (let index = 1; index < name.length; index += 1) {
    const previous = name[index - 1];
    const isWordStart = !(previous >= "a" && previous <= "z") && !(previous >= "0" && previous <= "9");
    if (isWordStart && name.startsWith(trimmed, index)) return true;
  }
  return false;
}

export interface DeviceContactPage {
  rows: DeviceContactListRow[];
  /** True when the cap hid rows, so the list can say so instead of lying. */
  truncated: boolean;
}

/**
 * The device rows to show for a query, capped.
 *
 * Returns whether anything was hidden rather than silently cutting the list.
 * A list that stops at fifty without saying so reads as "these are all of
 * them", and a person who cannot find their plumber then concludes we did not
 * read their contacts at all.
 */
export function filterDeviceContacts(
  rows: DeviceContactListRow[],
  query: string,
  limit: number = MAX_DEVICE_CONTACT_ROWS,
): DeviceContactPage {
  const matched = rows.filter((row) => deviceContactMatches(row, query));
  return {
    rows: matched.slice(0, limit),
    truncated: matched.length > limit,
  };
}
