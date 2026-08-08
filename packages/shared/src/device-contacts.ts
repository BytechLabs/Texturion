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

/**
 * Every device row that answers what somebody typed. All of them.
 *
 * # Why there is no cap here any more (#547)
 *
 * There was one, at fifty, and it produced a defect the founder found in a
 * minute of use: the collapsed group showed five rows under a "Show all from
 * this phone" button, and pressing it showed FIFTY, followed by the sentence
 * "Showing the first 50. Search to find someone else." A control labelled
 * "Show all" that does not show all is worse than no control, and the sentence
 * under it was the product admitting so.
 *
 * The cap was never protecting anything. These rows never leave the phone and
 * are already in memory — the dialer loaded the address book — and both clients
 * render them in a virtualised list, so the four-hundredth row costs nothing
 * until somebody scrolls to it. The cap was bounding a cost that does not
 * exist, at the price of the one thing the feature is for.
 *
 * The PREVIEW is still capped, and that is a different decision made in a
 * different place: each client takes its own head of this list while the group
 * is collapsed, because a personal address book above the crew's shared one
 * would bury the thing the product is for. That is a layout choice and it
 * belongs to the layout, not to the search.
 */
export function filterDeviceContacts(
  rows: DeviceContactListRow[],
  query: string,
): DeviceContactListRow[] {
  return rows.filter((row) => deviceContactMatches(row, query));
}
