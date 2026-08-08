/**
 * #540 — which parts of the landing screen a member is allowed to put away.
 *
 * ## The line, and why it is drawn here rather than "everything is optional"
 *
 * A dashboard nobody can adjust becomes somebody else's dashboard: an owner who
 * never sells on referrals still reads past "Where customers came from" every
 * morning. So the measures come off.
 *
 * The QUEUES do not. Hiding "Unassigned" is not a preference — it is a way to
 * stop seeing leads that nobody has claimed, and the first time it matters the
 * cost is a customer who texted and got nothing back. The same for the rest of
 * the queue and for "Chase these", which is on the screen only because the
 * member asked to be reminded. Work is not decoration; you can finish it, but you
 * cannot switch it off.
 *
 * So the hideable set is exactly: the four measures, and the call history.
 *
 * ## And why there is no manual reordering
 *
 * `dashboard-tiles.ts` now orders the queue by what has actually gone wrong —
 * overdue first, then stale. A member-defined order would sit on top of that and
 * the first thing it would do is put an overdue task underneath "Unread", which
 * is the exact defect the ordering was added to fix. An order that is earned by
 * urgency is worth more than one that was set once in April and never revisited.
 */

/**
 * The panels a member can put away, in the order the customise list offers them.
 *
 * Stable ids — they are stored. The declaration is the tuple rather than the
 * union so that the union is DERIVED from it: a list and a type that have to be
 * kept in step by hand is a list and a type that eventually disagree, and the
 * disagreement shows up as a panel nobody can turn off.
 */
export const DASHBOARD_PANEL_IDS = [
  "response_time",
  "pipeline",
  "satisfaction",
  "lead_sources",
  "recent_calls",
] as const;

export type DashboardPanelId = (typeof DASHBOARD_PANEL_IDS)[number];

/**
 * What each panel is called where it can be turned off.
 *
 * The label a member reads in the list has to be the heading they see on the
 * screen, or the switch is a guess. These match the card headings, not the ids.
 */
export const DASHBOARD_PANEL_LABELS: Record<DashboardPanelId, string> = {
  response_time: "Response time",
  pipeline: "Pipeline",
  satisfaction: "Satisfaction",
  lead_sources: "Where customers came from",
  recent_calls: "Recent calls",
};

/**
 * One line saying what a panel is for, shown under its name.
 *
 * Somebody deciding whether to keep a panel is deciding about the QUESTION it
 * answers, and four headings on their own do not distinguish "Pipeline" from
 * "Response time" for anybody who has not already read both cards.
 */
export const DASHBOARD_PANEL_NOTES: Record<DashboardPanelId, string> = {
  response_time: "How fast new customers got an answer this week.",
  pipeline: "What is quoted, booked, and waiting on a decision.",
  satisfaction: "Whether the people you answered were happy.",
  lead_sources: "Which channels are actually bringing work in.",
  recent_calls: "The last few calls, in and out.",
};

/** Nothing hidden. A new member gets the whole screen and takes things off it. */
export const DASHBOARD_PANELS_DEFAULT: readonly DashboardPanelId[] = [];

function isPanelId(value: string): value is DashboardPanelId {
  return (DASHBOARD_PANEL_IDS as readonly string[]).includes(value);
}

/**
 * Clean a stored or submitted hidden-set into something safe to render from.
 *
 * Unknown ids are DROPPED rather than rejected, and that direction is deliberate:
 * a member whose stored set mentions a panel this build has never heard of — a
 * renamed card, a client one release behind, a panel we withdrew — should get a
 * working dashboard, not an error. Dropping an id shows them a panel they had put
 * away, which they can put away again; refusing the whole set would show them a
 * broken screen.
 *
 * Duplicates collapse, and the result is in `DASHBOARD_PANEL_IDS` order so the
 * stored value does not depend on which order somebody happened to click.
 */
export function normaliseHiddenPanels(hidden: readonly string[]): DashboardPanelId[] {
  const set = new Set(hidden.filter(isPanelId));
  return DASHBOARD_PANEL_IDS.filter((id) => set.has(id));
}

/** Is this panel on the screen? The question every call site actually asks. */
export function isPanelVisible(
  hidden: readonly string[],
  panel: DashboardPanelId,
): boolean {
  return !hidden.includes(panel);
}
