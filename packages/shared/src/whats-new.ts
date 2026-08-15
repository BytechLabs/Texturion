/**
 * #321 — what actually changed for a customer, in their words.
 *
 * # Why this is not the release-please changelog
 *
 * #321 asks for the audiences to be separated, and they are different documents
 * with different jobs. `CHANGELOG.md` is generated per app from every `feat` and
 * `fix`, and it is honest developer history: forty entries a month, several of
 * which are the same repair described from two sides.
 *
 * A customer does not want history. They want to know that the thing they use
 * got better, in a grain they can read in ten seconds, with somewhere to go and
 * try it. So this is curated, and being curated is the feature: "not every
 * commit is news, and pretending otherwise trains people to ignore it."
 *
 * # It lives in shared because three clients show it
 *
 * The public page renders the list; the app shows an unobtrusive marker when
 * something is newer than the last time this member looked. Android and iOS
 * need the same dates to make the same decision, and a marker that lights up on
 * one client and not another is worse than no marker.
 *
 * # The honesty rule, which is the whole credibility of the surface
 *
 * ENTRIES REPORT WHAT SHIPPED. Never what is planned, never what is coming
 * soon. #321 states the rule and the reason: "a roadmap presented as news is how
 * a changelog loses its credibility, and once lost it does not come back."
 *
 * A test enforces the readable half of that — no future dates, no "coming
 * soon", no "will".
 */

export interface WhatsNewEntry {
  /** ISO date the change reached customers, not the date it was written. */
  date: string;
  /**
   * Catalogue key for one line: what they can now do.
   *
   * #228: a key rather than the sentence. Three clients render this list, and
   * a changelog is exactly the surface where an English paragraph in a French
   * app reads as the product not being finished.
   */
  title: string;
  /** Catalogue key for two sentences at most: why it matters, not how it works. */
  body: string;
  /**
   * Where the thing IS, as an in-app path.
   *
   * #321: "point at the feature, not just describe it. The value is in taking
   * someone to the thing on the screen where it now exists." Null only when the
   * change has no single home — a fix that makes everything a little better has
   * nowhere to send anybody, and inventing a destination wastes their tap.
   */
  href: string | null;
}

/**
 * Newest first. Dates are the day the release shipped.
 *
 * Kept short on purpose. A changelog nobody scrolls is a changelog whose newest
 * entry is the only one that matters, and the marker only ever reflects the top
 * of this list.
 */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    date: "2026-08-01",
    title: "settingsMore.whatsNewSavedViewsTitle",
    body: "settingsMore.whatsNewSavedViewsBody",
    href: "/inbox",
  },
  {
    date: "2026-08-01",
    title: "settingsMore.whatsNewQuotesTitle",
    body: "settingsMore.whatsNewQuotesBody",
    href: "/for-you",
  },
  {
    date: "2026-07-25",
    title: "settingsMore.whatsNewVoicemailTitle",
    body: "settingsMore.whatsNewVoicemailBody",
    href: "/calls",
  },
  {
    date: "2026-07-24",
    title: "settingsMore.whatsNewDraftsTitle",
    body: "settingsMore.whatsNewDraftsBody",
    href: "/inbox",
  },
  {
    date: "2026-07-12",
    title: "settingsMore.whatsNewCallsTitle",
    body: "settingsMore.whatsNewCallsBody",
    href: "/calls",
  },
];

/** The newest entry's date, which is what a marker compares against. */
export function latestWhatsNewDate(entries: WhatsNewEntry[] = WHATS_NEW): string {
  return entries.reduce(
    (newest, entry) => (entry.date > newest ? entry.date : newest),
    "",
  );
}

/**
 * Is there something this member has not seen?
 *
 * `lastSeen` is an ISO date the client stores when they open the list. Null
 * means they have never looked — which is NOT the same as "everything is new".
 * A workspace that signed up today would otherwise land on a badge advertising
 * six months of changes they have no memory of missing, and a marker that is
 * always lit is a marker nobody reads.
 *
 * So a member who has never looked sees the marker only if something shipped
 * AFTER they arrived.
 */
export function hasUnseenWhatsNew(
  lastSeen: string | null,
  joinedAt: string | null,
  entries: WhatsNewEntry[] = WHATS_NEW,
): boolean {
  const latest = latestWhatsNewDate(entries);
  if (latest === "") return false;
  const floor = lastSeen ?? joinedAt;
  // No floor at all: nothing is known about this member, so say nothing rather
  // than guess. A wrong badge costs trust in every later one.
  if (floor === null) return false;
  return latest > floor.slice(0, 10);
}

/** Entries newer than the floor, for the list to mark as new. */
export function unseenEntries(
  lastSeen: string | null,
  joinedAt: string | null,
  entries: WhatsNewEntry[] = WHATS_NEW,
): WhatsNewEntry[] {
  const floor = lastSeen ?? joinedAt;
  if (floor === null) return [];
  return entries.filter((entry) => entry.date > floor.slice(0, 10));
}
