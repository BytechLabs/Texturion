/**
 * #403 — when the competitor ledgers were last checked against live pages.
 *
 * `compare-facts.test.ts` was better comparative-advertising hygiene than most
 * companies have: it asserted the competitor column carries a date, the footnote
 * publishes a verification date, and the footnote invites correction. But it
 * pinned that date to a STRING LITERAL, so the suite would have passed forever
 * asserting a 2 July 2026 verification no matter how old the underlying facts
 * became. It guaranteed the page *claims* a date; it could not guarantee anybody
 * had looked since. Staleness was the path of least resistance, on claims that
 * are legally exposed under the Competition Act and FTC guidance.
 *
 * So the date is DATA now, read by the pages and the test alike, and
 * {@link COMPARE_RECHECK_AFTER} makes going stale something a test fails on
 * rather than something nobody notices. Same posture as
 * `carrier-list-prices.ts` and `voice-ai-costs.ts`.
 *
 * TO RE-VERIFY: open each competitor's pricing page, check every figure the
 * ledger and footnote state, then move both dates. Do not move them without
 * looking — the whole value of publishing a date is that it is true.
 */

/**
 * The day both ledgers were last checked, figure by figure, against live pages.
 *
 * 2026-08-02 (#435): every existing figure re-read on heymarket.com/pricing and
 * quo.com/pricing and unchanged. The pass also established the two AI prices the
 * new capability rows cite: Heymarket's "Each AI Agent message costs 3x the base
 * rate", and Quo's Sona shipping on every plan with 1,000 automation credits at
 * 100 credits a call, then $1.00 down to $0.45 per call by tier.
 */
export const COMPARE_VERIFIED_ON = "2026-08-02";

/**
 * Re-check by this date. A quarter: competitor pricing moves on roughly that
 * cadence, and a claim about somebody else's price is the kind that gets
 * expensive rather than merely wrong when it rots.
 */
export const COMPARE_RECHECK_AFTER = "2026-11-02";

/**
 * The competitor column's dateline, derived so it cannot drift from
 * {@link COMPARE_VERIFIED_ON} — the drift the literal made invisible.
 */
export const COMPARE_AS_OF = asOfLabel(COMPARE_VERIFIED_ON);

/**
 * "August 2026" — the bare month, for prose that already supplies its own
 * "dated and sourced," lead-in.
 *
 * #435: four rendered strings (both page leads and two metadata descriptions)
 * carried a hardcoded "July 2026" while the table beside them derived its
 * dateline from the constant above. Moving the verification date left the hero
 * of each page contradicting its own ledger. Exported so there is one date on
 * these pages and no way to move half of it.
 */
export const COMPARE_MONTH = COMPARE_AS_OF.replace(/^as of /, "");

/** The same dateline for URL-selected marketing locales. */
export function compareMonth(locale: "en" | "fr-CA" = "en"): string {
  if (locale === "en") return COMPARE_MONTH;
  return new Intl.DateTimeFormat("fr-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${COMPARE_VERIFIED_ON}T00:00:00Z`));
}

export function compareAsOf(locale: "en" | "fr-CA" = "en"): string {
  return locale === "fr-CA" ? `en date de ${compareMonth(locale)}` : COMPARE_AS_OF;
}

/** "as of July 2026" for an ISO date. Pure, so the test can re-derive it. */
export function asOfLabel(isoDate: string): string {
  const [year, month] = isoDate.split("-");
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
  const name = MONTHS[Number(month) - 1];
  return name ? `as of ${name} ${year}` : `as of ${isoDate}`;
}
