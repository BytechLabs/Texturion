/**
 * [#410] How long they have been a customer, and how often — in one line.
 *
 * # Two facts, and deliberately not a third
 *
 * A count and a date are OBSERVATIONS. A score, a segment or a lifetime value
 * is a JUDGEMENT, and the line this product holds is that it never tells a
 * crew what a customer is worth — only how long they have been one. So this
 * formats exactly what the server derived and invents nothing.
 *
 * # Conversations, not messages
 *
 * A chatty customer is not a loyal one. Counting messages would rank the
 * person who sent nine texts about one job above the person who has called
 * every winter for four years, which is backwards in exactly the situation
 * this exists to inform.
 *
 * Hand-ported to Kotlin and Swift; `CONTACT_RELATIONSHIP_CASES` below is the
 * fixture all three are pinned against. Adding a case here means adding it
 * there.
 */

/** Months as the clients spell them. Fixed, not locale-derived: the three
 *  ports must agree, and a device locale is not a shared input. */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The identity-card line, or null when there is nothing worth saying.
 *
 * Null on a contact with no conversations at all — which is a contact somebody
 * typed in, or one whose history is entirely on numbers this member cannot
 * see. Both read as "nothing to tell you", which is the honest answer.
 */
export function contactRelationshipLine(
  conversationCount: number | null | undefined,
  firstConversationAt: string | null | undefined,
): string | null {
  const count = conversationCount ?? 0;
  if (count <= 0) return null;

  const conversations = count === 1 ? "1 conversation" : `${count} conversations`;

  const since = monthYear(firstConversationAt);
  // A count with no date still earns its place: "3 conversations" answers the
  // question this feature exists for, and inventing a date would not.
  return since ? `Customer since ${since} · ${conversations}` : conversations;
}

/** "March 2026" from an ISO timestamp, or null when it cannot be read. */
export function monthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Parsed off the STRING rather than through a Date, so a device timezone
  // cannot shift a January 1st booking into the previous December on one
  // client and not another.
  const match = /^(\d{4})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : null;
}

/**
 * The canonical cases. Kotlin and Swift hand-port this table case for case.
 *
 * [count, firstConversationAt, expected line]
 */
export const CONTACT_RELATIONSHIP_CASES: [
  number | null,
  string | null,
  string | null,
][] = [
  // Nothing to say: a contact somebody typed in, never texted.
  [0, null, null],
  [null, null, null],
  [0, "2026-03-04T10:00:00Z", null],
  // A first-timer still gets the line: "1 conversation" IS the signal that
  // they are new, which is half of what this feature is for.
  [1, "2026-03-04T10:00:00Z", "Customer since March 2026 · 1 conversation"],
  [7, "2026-03-04T10:00:00Z", "Customer since March 2026 · 7 conversations"],
  // The repeat customer this exists to make visible at a glance.
  [23, "2023-11-30T23:59:59Z", "Customer since November 2023 · 23 conversations"],
  // A count with no readable date still answers the question.
  [4, null, "4 conversations"],
  [4, "not a timestamp", "4 conversations"],
  // Month boundaries, where a Date-based port would drift by a timezone.
  [2, "2026-01-01T00:00:00Z", "Customer since January 2026 · 2 conversations"],
  [2, "2026-12-31T23:59:59Z", "Customer since December 2026 · 2 conversations"],
];
