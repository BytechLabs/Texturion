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

/**
 * Months as catalogue KEYS.
 *
 * The old comment said "fixed, not locale-derived: a device locale is not a
 * shared input", and that reasoning survives intact — it is about the DEVICE
 * locale, which differs per phone and would make three clients disagree. The
 * app locale is not that. It is the one the reader chose, every client already
 * resolves against it, and it is exactly as shared an input as this table was.
 *
 * French months are lower case mid-sentence — "Client depuis mars 2026" — and
 * that is the catalogue's business rather than this file's, which is the point
 * of naming keys here.
 */
const MONTH_KEYS = [
  "domain.monthJanuary",
  "domain.monthFebruary",
  "domain.monthMarch",
  "domain.monthApril",
  "domain.monthMay",
  "domain.monthJune",
  "domain.monthJuly",
  "domain.monthAugust",
  "domain.monthSeptember",
  "domain.monthOctober",
  "domain.monthNovember",
  "domain.monthDecember",
] as const;

/** Every key this module names. */
export type ContactRelationshipKey =
  | (typeof MONTH_KEYS)[number]
  | "domain.contactSince"
  | "domain.contactConversationOne"
  | "domain.contactConversationMany";

/** The reader's resolver. */
export type SayRelationship = (key: ContactRelationshipKey) => string;

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
  say: SayRelationship,
): string | null {
  const count = conversationCount ?? 0;
  if (count <= 0) return null;

  // One and many are separate keys, not one string with a count in it. English
  // gets away with an "s"; a language that agrees the noun, its article and its
  // verb with the number does not, and a single key would force whoever
  // translates this to pick one of the two and be wrong half the time.
  const conversations =
    count === 1
      ? say("domain.contactConversationOne")
      : say("domain.contactConversationMany").replace("{count}", String(count));

  const since = monthYear(firstConversationAt, say);
  // A count with no date still earns its place: "3 conversations" answers the
  // question this feature exists for, and inventing a date would not.
  return since
    ? say("domain.contactSince")
        .replace("{since}", since)
        .replace("{conversations}", conversations)
    : conversations;
}

/** "March 2026" from an ISO timestamp, or null when it cannot be read. */
export function monthYear(
  iso: string | null | undefined,
  say: SayRelationship,
): string | null {
  if (!iso) return null;
  // Parsed off the STRING rather than through a Date, so a device timezone
  // cannot shift a January 1st booking into the previous December on one
  // client and not another.
  const match = /^(\d{4})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  const key = MONTH_KEYS[Number(match[2]) - 1];
  // "mars 2026" in French too: month then year is the order in both, so the
  // join stays here rather than becoming a fourth key nobody would translate
  // differently.
  return key ? `${say(key)} ${match[1]}` : null;
}

/**
 * The canonical cases. Kotlin and Swift hand-port this table case for case.
 *
 * [count, firstConversationAt, expected line]
 *
 * #228: the expectations stay ENGLISH. What these pin is the RULE — when a
 * line appears, which half it drops, where the boundary months land — and
 * every client checks them with an English resolver. Translating the fixture
 * would test the catalogue instead, which is a different job and is done in
 * this module's own test.
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

/**
 * The THREAD-HEADER form of the same fact: a count, or nothing.
 *
 * # Why this is not just the line above
 *
 * #505: the person who most needs to know they are talking to a five-time
 * customer is the one replying right now, and they are looking at the thread,
 * not the panel — which defaults closed. But the header is a GLANCE surface
 * and the panel is a READING surface, and they should not carry the same
 * weight of text. The panel says "Customer since March 2026 · 7 conversations"
 * because somebody who opened it is reading; the header says "7 conversations"
 * because somebody mid-reply is not.
 *
 * # Why it says nothing below two
 *
 * `conversation_count` counts every conversation with this contact INCLUDING
 * the open one (`contactRelationship` in apps/api/src/routes/contacts.ts), so a
 * first-time caller reads exactly 1. A badge on every thread would be noise on
 * the common case to serve the uncommon one, and a header that decorates
 * everybody distinguishes nobody — which is the entire point of the feature.
 *
 * The panel keeps showing "1 conversation": there, being new IS information
 * worth a line. Here it is the absence of a badge, which says the same thing
 * without spending a glance.
 *
 * # Whose count this is
 *
 * The same number-access-filtered count the panel shows (#106/D88). A member
 * kept off a number must not learn the customer's history from a badge either.
 */
export function contactRepeatBadge(
  conversationCount: number | null | undefined,
  say: SayRelationship,
): string | null {
  const count = conversationCount ?? 0;
  if (count < REPEAT_CUSTOMER_MINIMUM) return null;
  // Always the plural key: the threshold is two, so this can never be one.
  return say("domain.contactConversationMany").replace("{count}", String(count));
}

/**
 * Two, because the open conversation is one of them.
 *
 * Named rather than inlined so the three clients cannot drift apart on the
 * threshold — the hand-ports mirror this constant, not the literal.
 */
export const REPEAT_CUSTOMER_MINIMUM = 2;

/**
 * The canonical badge cases. Kotlin and Swift hand-port this table too.
 *
 * [count, expected badge]
 */
export const CONTACT_REPEAT_BADGE_CASES: [number | null, string | null][] = [
  // Nothing at all, and a contact somebody typed in but never texted.
  [null, null],
  [0, null],
  // THE case: a first-time caller's header is unchanged. Their one
  // conversation is the one on screen.
  [1, null],
  // Two is the first time "we have spoken before" is true.
  [2, "2 conversations"],
  [7, "7 conversations"],
  [23, "23 conversations"],
  // A count that arrived negative is not a repeat customer either. Fail quiet
  // rather than rendering "-3 conversations" beside somebody's name.
  [-3, null],
];
