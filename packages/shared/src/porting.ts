/**
 * #319/#248 — what a customer must know while their number is being transferred,
 * in one place because all three clients have to say it.
 *
 * This lived in `apps/web/src/components/porting/copy.ts`, which is why only the
 * laptop said it. A port is managed from whatever device is to hand, and the
 * mistake this list prevents is available on every one of them.
 *
 * THE FIRST ITEM IS THE WHOLE REASON THIS EXISTS. Cancelling the old service
 * before the transfer completes can release the number back to the carrier pool,
 * and that is the one way a business genuinely loses the number on its trucks.
 * Our own writing has said so for months — in a blog post, which is not a place
 * anybody looks from inside the product, and certainly not at the moment they are
 * looking at a bill for a service they think they no longer need.
 */

/** The statuses a transfer is IN FLIGHT for, and the checklist is shown for. */
export const PORT_PRE_CUTOVER_STATUSES: readonly string[] = [
  "submitted",
  "in-process",
  "foc-date-confirmed",
  "activation-in-progress",
];

/**
 * Whether the transfer is far enough along to warn about, and not past it.
 *
 * Three exclusions, each on purpose:
 *
 *   `draft`      nothing is in flight yet, so there is nothing to be careful of.
 *   `exception`  the rejection notice owns that screen, and a checklist beneath
 *                it would bury the one thing the reader has to act on.
 *   `ported` on  too late to export anything, and moot once the switch happened.
 *
 * An allowlist rather than a list of the statuses to hide it for: a status added
 * later starts silent and gets considered, instead of inheriting a warning that
 * may be wrong for it.
 */
export function isBeforePortCutover(status: string): boolean {
  return PORT_PRE_CUTOVER_STATUSES.includes(status);
}

/** One row: a bold lead a skim can stop at, and the reason under it. */
export interface PortPreCutoverItem {
  lead: string;
  detail: string;
}

/**
 * The list itself, in the order a reader meets the consequences.
 *
 * Deliberately not phrased as an alert on any client: nothing has gone wrong
 * while a transfer is in flight, and shouting under a "locked in" banner reads as
 * a contradiction of it.
 */
/*
 * #228: the three copy fields are catalogue KEYS.
 *
 * The ORDER is still the copy here, and that is the point of the list rather
 * than a detail of it: cancelling early is the one mistake that can genuinely
 * lose the number, so it stays first in every language. The keys move; the
 * sequence does not.
 */
export const PORT_PRE_CUTOVER_CHECKLIST: {
  heading: string;
  items: readonly PortPreCutoverItem[];
} = {
  heading: "settingsMore.beforeSwitch",
  items: [
    {
      lead: "settingsMore.cutoverKeepOld",
      detail: "settingsMore.cutoverKeepOldDetail",
    },
    {
      lead: "settingsMore.cutoverExport",
      detail: "settingsMore.cutoverExportDetail",
    },
    {
      lead: "settingsMore.cutoverTellCrew",
      detail: "settingsMore.cutoverTellCrewDetail",
    },
    {
      lead: "settingsMore.cutoverTextsTrail",
      detail: "settingsMore.cutoverTextsTrailDetail",
    },
  ],
};
