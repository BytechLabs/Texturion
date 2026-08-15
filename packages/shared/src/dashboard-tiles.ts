/**
 * #540 — the dashboard's summary strip, decided rather than laid out.
 *
 * ## What was wrong with it
 *
 * Four boxes, each holding a label and a number, in a fixed order, that could not
 * be clicked. That is the whole strip. It told an owner opening the app that there
 * were "3" of something and left them to work out which 3 mattered, where they
 * were, and what to do — and it looked identical whether all three were an hour
 * old or a week old.
 *
 * Three specific failures, and they are the words the issue used:
 *
 *   NOT DYNAMIC     the order never changed, so the most urgent thing was
 *                   wherever its category happened to sit. A strip whose first
 *                   slot is not the thing to do first is decoration.
 *   NOT CONTEXTUAL  a count with no age is not a signal. "4 unread" is a
 *                   different morning depending on whether the oldest is four
 *                   minutes or four days old, and only one of those is a problem.
 *   AMATEUR         they were `div`s. The number that tells you where the work is
 *                   was not a way of getting to it.
 *
 * ## Why the decision is shared and the formatting is not
 *
 * Which tile leads, and what signal it carries, must be the same on a laptop and
 * in a van — an owner who learns the strip on one and finds a different order on
 * the other has learned nothing. So the ordering and the signal are here.
 *
 * Rendering a duration is NOT here, deliberately: each client already has its own
 * relative-time formatter with its own rounding and its own words, and a fifth
 * one would drift from the four beside it. This returns the fact ("the oldest is
 * this many milliseconds old") and lets each client say it in its own voice.
 */

/** The four things a member can be behind on. Stable ids, not display order. */
export type DashboardTileId = "unassigned" | "waiting" | "tasks" | "unread";

/**
 * What makes a count worth looking at.
 *
 * `null` when a tile is empty. An empty tile keeps its place in the strip rather
 * than disappearing — a strip whose tiles come and go is one nobody can build a
 * habit around, and "nothing unassigned" is itself worth seeing.
 */
export type DashboardSignal =
  /** Some of these are past their due date. The strongest signal there is. */
  | { kind: "overdue"; count: number }
  /** Nothing is overdue, but the oldest has been waiting this long. */
  | { kind: "oldest"; ageMillis: number }
  | null;

export interface DashboardTile {
  id: DashboardTileId;
  count: number;
  signal: DashboardSignal;
}

/** One row's worth of what this module needs. Clients pass what they have. */
export interface DashboardTileInput {
  /** Unassigned conversations and tasks — `last_message_at` as epoch millis. */
  unassignedAgesMillis: readonly number[];
  /** Threads waiting on this member; `overdue` is an overdue-task link. */
  waiting: readonly { ageMillis: number; overdue: boolean }[];
  /** This member's tasks. A task with no due date is never overdue. */
  tasks: readonly { ageMillis: number | null; overdue: boolean }[];
  /** Unread threads — age of the unread message. */
  unreadAgesMillis: readonly number[];
}

/**
 * How much attention a tile has earned, lower first.
 *
 * The rank is deliberately coarse — overdue, then aged, then merely present, then
 * empty — because a strip that reshuffles on a five-minute difference is a strip
 * that has moved every time somebody looks at it. Age breaks a tie only among
 * tiles that are ALREADY aged, where a difference means hours; everything fresher
 * keeps the reading order of the sections below.
 */
function rank(tile: DashboardTile): number {
  if (tile.count === 0) return 3;
  if (tile.signal?.kind === "overdue") return 0;
  if (tile.signal?.kind === "oldest" && tile.signal.ageMillis >= AGED_MILLIS) return 1;
  return 2;
}

/**
 * When "waiting" becomes "waiting too long" — four hours.
 *
 * Not five minutes, which is #388's reply window and the thing the inbox itself
 * shouts about. This is the strip on the landing screen, and its job is the
 * morning triage question rather than the live one: anything from earlier today is
 * ordinary, anything from before lunch is a customer wondering if they were heard.
 */
export const AGED_MILLIS = 4 * 60 * 60 * 1000;

/** The oldest age in a list, or null when the list is empty. */
function oldest(ages: readonly (number | null)[]): number | null {
  let best: number | null = null;
  for (const age of ages) {
    if (age === null) continue;
    if (best === null || age > best) best = age;
  }
  return best;
}

function signalFor(
  ages: readonly (number | null)[],
  overdueCount: number,
): DashboardSignal {
  if (overdueCount > 0) return { kind: "overdue", count: overdueCount };
  const age = oldest(ages);
  return age === null ? null : { kind: "oldest", ageMillis: age };
}

/**
 * The strip, in the order it should be read.
 *
 * Ordering happens here rather than in each client because it IS the feature: the
 * complaint was a dashboard that looked the same whatever was happening, and the
 * fix is that the first tile is the one to act on.
 */
export function dashboardTiles(input: DashboardTileInput): DashboardTile[] {
  const tiles: DashboardTile[] = [
    {
      id: "unassigned",
      count: input.unassignedAgesMillis.length,
      // Nobody owns these, so nothing about them can be "overdue" to a person.
      // Age is the whole signal: unclaimed work going stale is the failure.
      signal: signalFor(input.unassignedAgesMillis, 0),
    },
    {
      id: "waiting",
      count: input.waiting.length,
      signal: signalFor(
        input.waiting.map((row) => row.ageMillis),
        input.waiting.filter((row) => row.overdue).length,
      ),
    },
    {
      id: "tasks",
      count: input.tasks.length,
      signal: signalFor(
        input.tasks.map((row) => row.ageMillis),
        input.tasks.filter((row) => row.overdue).length,
      ),
    },
    {
      id: "unread",
      count: input.unreadAgesMillis.length,
      signal: signalFor(input.unreadAgesMillis, 0),
    },
  ];

  // A STABLE sort, and the fallback order matters: with nothing to separate two
  // tiles they stay in the order above, which is the order the sections below
  // them appear in. A strip that disagrees with the page under it is worse than
  // one that never moves.
  return tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => {
      const rankA = rank(a.tile);
      const byRank = rankA - rank(b.tile);
      if (byRank !== 0) return byRank;
      // AGE BREAKS A TIE ONLY AMONG TILES THAT ARE ALREADY AGED. Sorting every
      // rank by age is what the first version did, and it contradicted the
      // paragraph above it: two fresh tiles thirty and thirty-one minutes old
      // would swap places, so the strip moved every time somebody looked at it.
      // Its own test caught that. Within rank 1 every tile is past four hours, so
      // a swap there means hours and is worth showing; below it, "today, fine" is
      // the same answer for all of them and the page's reading order wins.
      if (rankA === 1) {
        const ageA = a.tile.signal?.kind === "oldest" ? a.tile.signal.ageMillis : 0;
        const ageB = b.tile.signal?.kind === "oldest" ? b.tile.signal.ageMillis : 0;
        if (ageA !== ageB) return ageB - ageA;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.tile);
}

/** What each tile is called, and where tapping it goes. */
/**
 * Every catalogue key the four tiles name.
 *
 * The prefix is `inbox.forYouSection` because all three clients have said
 * these four from those keys for months — the section headings on the For You
 * screen and the queue tiles are the same words for the same thing, and
 * minting a second set would put "Unassigned" in two catalogues.
 */
export type DashboardTileKey =
  | "inbox.forYouSectionUnassigned"
  | "inbox.forYouSectionWaiting"
  | "inbox.forYouSectionTasks"
  | "inbox.forYouSectionUnread";

export const DASHBOARD_TILE_LABELS: Record<DashboardTileId, DashboardTileKey> = {
  unassigned: "inbox.forYouSectionUnassigned",
  waiting: "inbox.forYouSectionWaiting",
  tasks: "inbox.forYouSectionTasks",
  unread: "inbox.forYouSectionUnread",
};
