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
export const PORT_PRE_CUTOVER_CHECKLIST: {
  heading: string;
  items: readonly PortPreCutoverItem[];
} = {
  heading: "Before your number switches",
  items: [
    {
      lead: "Keep your old service active.",
      detail:
        "Cancelling before the transfer finishes can release the number back to the carrier, and that is the one way to genuinely lose it.",
    },
    {
      lead: "Export your message history.",
      detail: "The number moves, your old conversations do not.",
    },
    {
      lead: "Tell the crew the switch date.",
      detail:
        "From that morning, calls and texts arrive in this inbox instead of the old one.",
    },
    {
      lead: "Expect texting to trail calls.",
      detail:
        "Voice and texting can finish on different clocks, so texts may take an extra day. We will tell you when both are live.",
    },
  ],
};
