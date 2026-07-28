/**
 * #392 — the seat allowance, in one place.
 *
 * Starter 3 / Pro 15 was written out four times: the API, the web client,
 * Android and iOS. `packages/shared` exists precisely to stop that and had no
 * seat module at all — this rule was shared by none of the four.
 *
 * WHY SEATS SPECIFICALLY. This constant has already moved twice (5-and-
 * unlimited, then 3/15/unlimited). It is not an architectural fact, it is a
 * PRICING LEVER, and pricing levers get pulled. The next pull had to land in
 * four files in four languages simultaneously, two of which cannot even be
 * compiled on the machine the change is made on.
 *
 * And the failure is asymmetric in both directions. A client copy HIGHER than
 * the API's tells an owner they have room, then the API 409s the invite — at
 * the exact moment they are trying to grow, which reads as a bug. A copy LOWER
 * fires the upgrade nudge early or never, and the upsell is lost silently.
 * A drifted seat number does not degrade a feature; it misprices the product
 * on one platform.
 *
 * The real fix is that clients should not compute this at all — the server
 * sends `seat_limit` and `seats_used` and they render it. What lives here is
 * the formula the SERVER uses, plus the fallback a client needs when it has
 * never successfully loaded (see PLAN_SEATS below).
 */

export type SeatPlan = "starter" | "pro";

/**
 * Seats per plan.
 *
 * Clients keep a copy of this ONLY as an offline fallback, never as the value
 * they display when the server has spoken. A stale fallback used while
 * disconnected is a far smaller hazard than four authoritative copies, and it
 * makes the drift visible rather than silent.
 */
export const PLAN_SEATS: Record<SeatPlan, number> = {
  starter: 3,
  pro: 15,
};

/**
 * Seat allowance for a company.
 *
 * A company that has never checked out has plan NULL (SPEC §6) and gets the
 * STARTER allowance, so a team can be assembled before payment without
 * exceeding what the smallest plan would permit. Defaulting to Pro here would
 * let an unpaid workspace build a 15-person crew and then be told, at
 * checkout, that twelve of them have to go.
 */
export function seatLimit(plan: string | null | undefined): number {
  return plan === "pro" ? PLAN_SEATS.pro : PLAN_SEATS.starter;
}

/** Whether a company can move to a bigger plan by itself. */
export function canUpgradeSeats(plan: string | null | undefined): boolean {
  // Pro is the top self-serve plan; Enterprise is a conversation, not a button.
  return plan !== "pro";
}

export interface SeatUsage {
  used: number;
  limit: number;
  /** At or over the ceiling: the next invite will be refused. */
  full: boolean;
  /** Full AND there is a bigger self-serve plan to move to. */
  canUpgrade: boolean;
  /** The sentence a client renders. */
  line: string;
}

/**
 * How many seats are spoken for, and what to say about it.
 *
 * `used` counts active members PLUS pending unexpired invites. Counting only
 * members would let two pending invites oversubscribe a plan the moment both
 * are accepted, which is why the API enforces this at invite creation AND at
 * acceptance. Expired and revoked invites correctly hold nothing.
 */
export function seatUsage(
  activeMembers: number,
  pendingInvites: number,
  plan: string | null | undefined,
  limitOverride?: number | null,
): SeatUsage {
  // The server's number wins whenever we have it. The computed limit is the
  // fallback for a client that has never loaded, and for the server itself.
  const limit =
    typeof limitOverride === "number" && limitOverride > 0
      ? limitOverride
      : seatLimit(plan);
  const used = activeMembers + pendingInvites;
  const full = used >= limit;
  const canUpgrade = full && canUpgradeSeats(plan);
  const line = canUpgrade
    ? `${used} of ${limit} seats. Upgrade for more`
    : `${used} of ${limit} seats`;
  return { used, limit, full, canUpgrade, line };
}
