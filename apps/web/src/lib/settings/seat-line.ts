import type { Invite, Member, PlanId } from "@/lib/api/types";

/**
 * Seat math for /settings/team (G8), mirroring the API's seat formula
 * (apps/api/src/routes/team.ts + routes/core/plans.ts): seat usage = active
 * members (deactivated_at IS NULL) + pending unexpired invites, compared to
 * the plan's seat allowance (SPEC §2: Starter 3, Pro 15; plan NULL reads as the
 * Starter allowance). Unlimited seats are the contact-sales Enterprise tier,
 * not a self-serve plan, so both plans here have a finite cap (#83).
 */

/** Seats per plan (SPEC §2) — mirror of the API's PLAN_SEATS. */
export const PLAN_SEATS: Record<PlanId, number> = {
  starter: 3,
  pro: 15,
};

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
  /** The G8 seat line, e.g. "2 of 3 seats. Upgrade for more". */
  line: string;
}

/**
 * The G8 seat usage line. Shows "used of N seats"; at capacity it points at the
 * upgrade path — but only from Starter, since Pro is the top self-serve plan
 * (unlimited seats are the contact-sales Enterprise tier, not an in-app
 * upgrade). A NULL plan reads as the Starter allowance, so it gets the nudge.
 */
export function seatUsage(
  activeMembers: number,
  pendingInvites: number,
  plan: PlanId | null,
): SeatUsage {
  const limit = seatLimit(plan);
  const used = activeMembers + pendingInvites;
  const full = used >= limit;
  const canUpgrade = plan !== "pro";
  const line =
    full && canUpgrade
      ? `${used} of ${limit} seats. Upgrade for more`
      : `${used} of ${limit} seats`;
  return { used, limit, full, line };
}
