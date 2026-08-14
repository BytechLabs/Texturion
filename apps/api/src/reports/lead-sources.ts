/**
 * #301 — conversations by source, and the part of the answer that is "we don't
 * know".
 *
 * The issue's fourth Acceptance line is the one this file is shaped by:
 * *"Reporting distinguishes attributed from unknown, and never infers
 * silently."* That is not a caveat on the report — it is the report's most
 * important number.
 *
 * A contractor looking at "Google 40, Truck 30, Yard sign 30" concludes their
 * yard sign is worth a third of their business. If two hundred other
 * conversations had no source at all, the honest sentence is that they know
 * where a third of their customers came from and are guessing about the rest —
 * and those are completely different decisions about where to spend next
 * month. A report that hides its own coverage is worse than no report, because
 * it is acted on.
 *
 * So `unknown` is a first-class row, `coverage` is computed, and the
 * attributed counts are split by HOW we came to believe them: a line ringing
 * is a fact about our own infrastructure, and a tech tapping a chip is a
 * report of what a customer said. Both are worth having and they are not the
 * same kind of thing.
 */

/** One source's share of the window. */
export interface LeadSourceCount {
  /** Null for the unknown row — it is a real bucket, not a missing one. */
  lead_source_id: string | null;
  name: string;
  /** Attributed automatically, by which line rang. */
  by_number: number;
  /** A person said so. */
  by_person: number;
  total: number;
}

export interface LeadSourceReport {
  days: number;
  /** Every source with at least one conversation, biggest first. */
  sources: LeadSourceCount[];
  /**
   * #232 — conversations that started at the website widget.
   *
   * Its own field rather than a row in `sources`, because it is not one: a
   * lead source is a thing somebody configured and named, and this is a fact
   * about which door the conversation came through. Keeping it out of the list
   * also keeps the label on the client, where it can be translated — a name
   * invented by the server would be English on all three clients forever.
   *
   * DISJOINT from `sources` and from `unknown`: the SQL credits a conversation
   * that started at the widget to the widget and to nothing else, so these
   * three buckets partition the window and sum to `total`. Without that a card
   * drawing all three as rows would show rows adding up past its own footer.
   *
   * The one exception is a conversation a PERSON tagged, which stays with the
   * source they named — their answer outranks our inference.
   */
  widget: number;
  /**
   * Conversations in the window with no source at all — and, since #232, none
   * of the widget ones, which we can place exactly.
   */
  unknown: number;
  /** Every conversation in the window, attributed or not. */
  total: number;
  /**
   * The fraction we can actually account for, 0–1, or null when there were no
   * conversations at all. Null rather than 0 because "nothing happened" and
   * "nothing was attributed" are different, and only one of them is a problem
   * worth showing somebody.
   */
  coverage: number | null;
}

/** The row shape the SQL side returns, before it is shaped for a client. */
export interface LeadSourceRollupRow {
  lead_source_id: string | null;
  name: string | null;
  by_number: number;
  by_person: number;
  /**
   * #232: started at the website widget, and therefore NOT in the two counts
   * above or in this row's `total` — the SQL takes them out. See the migration
   * for why the fact of where a conversation started beats the inference from
   * which line rang, and why a person's own tag beats both.
   */
  by_widget: number;
  /**
   * Every conversation in the group, and NOT `by_number + by_person`.
   *
   * The unknown bucket is why. An unattributed conversation has no origin, so
   * both sub-counts skip it and their sum is zero — the row would arrive and
   * then read as nothing, which is precisely the omission #301's fourth
   * Acceptance line forbids. Counting the group directly is the only shape
   * where "unknown" can be a row.
   */
  total: number;
}

/**
 * Turn the rollup into the report, unknown row included.
 *
 * Pure, so the honesty rules above are testable without a database — and so
 * the three clients cannot each derive `coverage` slightly differently, which
 * is how one screen ends up more optimistic than another about the same
 * numbers.
 */
export function buildLeadSourceReport(
  rows: LeadSourceRollupRow[],
  days: number,
): LeadSourceReport {
  const sources: LeadSourceCount[] = [];
  let unknown = 0;
  let widget = 0;

  for (const row of rows) {
    const byNumber = Number(row.by_number) || 0;
    const byPerson = Number(row.by_person) || 0;
    const byWidget = Number(row.by_widget) || 0;
    // The group's own count — see the note on `total` above. Deriving it from
    // the two sub-counts would silently drop every unattributed conversation.
    const total = Number(row.total) || 0;
    // #232 BEFORE the empty check, not after. A group whose conversations ALL
    // came through the website has a `total` of zero and is not a row — and
    // dropping it here would take its widget count with it, which is the one
    // case where the website mattered most.
    widget += byWidget;
    if (total === 0) continue;
    if (row.lead_source_id === null) {
      unknown += total;
      continue;
    }
    sources.push({
      lead_source_id: row.lead_source_id,
      // A source that has been archived still names itself in a report about
      // the period it was in use — that is the whole reason archiving exists
      // instead of deleting.
      name: row.name ?? "(removed)",
      by_number: byNumber,
      by_person: byPerson,
      total,
    });
  }

  // Biggest first, then by name so equal counts do not shuffle between loads.
  sources.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const configured = sources.reduce((sum, row) => sum + row.total, 0);
  // #232: a website conversation is accounted for. Coverage is the whole point
  // of this report — it is what tells somebody whether the ranking above it is
  // worth acting on — so a channel we can name exactly has to count towards it,
  // or installing the widget would make the report look WORSE the more it was
  // used. Safe to add because the SQL takes these OUT of the source groups:
  // the three buckets partition the window rather than overlapping it.
  const attributed = configured + widget;
  const total = attributed + unknown;
  return {
    days,
    sources,
    widget,
    unknown,
    total,
    coverage: total === 0 ? null : attributed / total,
  };
}

/**
 * Coverage low enough that the ranking above it is not yet worth acting on.
 *
 * Half is not a statistical threshold and does not pretend to be. It is the
 * point past which the unknown bucket could reorder every row in the table —
 * with 40% unattributed, a source sitting third could genuinely be first — so
 * presenting a ranking without saying so would be the silent inference #301
 * forbids.
 */
export const LOW_COVERAGE = 0.5;

/**
 * The sentence to show above the table, or null when the numbers speak for
 * themselves.
 *
 * Written here rather than in three clients for the same reason `coverage` is:
 * a warning that appears on web and not on the phone is a warning that does
 * not exist for the person reading it in a van.
 */
export function coverageNote(report: LeadSourceReport): string | null {
  if (report.total === 0) return null;
  if (report.coverage === null || report.coverage >= LOW_COVERAGE) return null;
  const pct = Math.round(report.coverage * 100);
  return (
    `You know where ${pct}% of these customers came from. The other ` +
    `${report.unknown} could change this order completely, so treat it as a ` +
    `hint rather than an answer — put a source on the lines you advertise, ` +
    `and the rest fills itself in.`
  );
}
