import type { Invite, Member, PlanId } from "@/lib/api/types";

/**
 * Seat math for /settings/team (G8), mirroring the API's seat formula
 * (apps/api/src/routes/team.ts + routes/core/plans.ts): seat usage = active
 * members (deactivated_at IS NULL) + pending unexpired invites, compared to
 * the plan's seat allowance (SPEC §2: Starter 3, Pro 10; plan NULL reads as
 * the Starter allowance).
 */

/** Seats per plan (SPEC §2) — mirror of the API's PLAN_SEATS table. */
export const PLAN_SEATS: Record<PlanId, number> = { starter: 3, pro: 10 };

/** Mirror of the API's `seatLimit`: plan NULL gets the Starter allowance. */
export function seatLimit(plan: PlanId | null): number {
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
  /** The plan's seat allowance. */
  limit: number;
  /** No more invites possible without freeing a seat (or upgrading). */
  full: boolean;
  /** The G8 seat line, e.g. "3 of 3 seats — upgrade for more". */
  line: string;
}

/**
 * The G8 seat usage line. Starter at capacity points at the upgrade path;
 * Pro at capacity has no bigger plan, so the line stays factual.
 */
export function seatUsage(
  activeMembers: number,
  pendingInvites: number,
  plan: PlanId | null,
): SeatUsage {
  const limit = seatLimit(plan);
  const used = activeMembers + pendingInvites;
  const full = used >= limit;
  const line =
    full && plan !== "pro"
      ? `${used} of ${limit} seats. Upgrade for more`
      : `${used} of ${limit} seats`;
  return { used, limit, full, line };
}
