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

/** The day both ledgers were last checked, figure by figure, against live pages. */
export const COMPARE_VERIFIED_ON = "2026-07-29";

/**
 * Re-check by this date. A quarter: competitor pricing moves on roughly that
 * cadence, and a claim about somebody else's price is the kind that gets
 * expensive rather than merely wrong when it rots.
 */
export const COMPARE_RECHECK_AFTER = "2026-10-29";

/**
 * The competitor column's dateline, derived so it cannot drift from
 * {@link COMPARE_VERIFIED_ON} — the drift the literal made invisible.
 */
export const COMPARE_AS_OF = asOfLabel(COMPARE_VERIFIED_ON);

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
