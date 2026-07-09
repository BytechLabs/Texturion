import type { Invite, Member, PlanId } from "@/lib/api/types";

/**
 * Seat math for /settings/team (G8), mirroring the API's seat formula
 * (apps/api/src/routes/team.ts + routes/core/plans.ts): seat usage = active
 * members (deactivated_at IS NULL) + pending unexpired invites, compared to
 * the plan's seat allowance (SPEC §2: Starter 5, Pro unlimited; plan NULL reads
 * as the Starter allowance).
 */

/** Seats per plan (SPEC §2) — mirror of the API's PLAN_SEATS. Pro is `null` =
 *  unlimited (#83). */
export const PLAN_SEATS: Record<PlanId, number | null> = {
  starter: 5,
  pro: null,
};

/** Mirror of the API's `seatLimit`: plan NULL gets the Starter allowance; Pro
 *  returns null = unlimited. */
export function seatLimit(plan: PlanId | null): number | null {
  return plan === "pro" ? PLAN_SEATS.pro : PLAN_SEATS.starter;
}

/** Active members — same filter the API counts (`deactivated_at IS NULL`). */
export function countActiveMembers(
  members: readonly Pick<Member, "deactivated_at">[],
): number {
  return members.filter((m) => m.deactivated_at === null).length;
}

/**
 * Pending invites — the API's exact formula: not accepted, not revoked,
 * not expired. Expired/revoked invites do not hold a seat.
 */
export function countPendingInvites(
  invites: readonly Pick<Invite, "accepted_at" | "revoked_at" | "expires_at">[],
  now: Date = new Date(),
): number {
  return invites.filter(
    (i) =>
      i.accepted_at === null &&
      i.revoked_at === null &&
      new Date(i.expires_at).getTime() > now.getTime(),
  ).length;
}

export interface SeatUsage {
  /** Seats in use: active members + pending invites. */
  used: number;
  /** The plan's seat allowance; null = unlimited (Pro, #83). */
  limit: number | null;
  /** No more invites possible without freeing a seat (or upgrading). */
  full: boolean;
  /** The G8 seat line, e.g. "3 of 5 seats. Upgrade for more". */
  line: string;
}

/**
 * The G8 seat usage line. Starter shows "used of N seats" and points at the
 * upgrade path at capacity; Pro is unlimited (#83) — never full, and the line
 * drops the "of N" ceiling entirely.
 */
export function seatUsage(
  activeMembers: number,
  pendingInvites: number,
  plan: PlanId | null,
): SeatUsage {
  const limit = seatLimit(plan);
  const used = activeMembers + pendingInvites;
  if (limit === null) {
    return {
      used,
      limit,
      full: false,
      line: `${used} ${used === 1 ? "teammate" : "teammates"}`,
    };
  }
  const full = used >= limit;
  const line = full
    ? `${used} of ${limit} seats. Upgrade for more`
    : `${used} of ${limit} seats`;
  return { used, limit, full, line };
}
