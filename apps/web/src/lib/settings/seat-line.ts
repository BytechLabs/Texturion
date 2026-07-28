import type { Invite, Member } from "@/lib/api/types";

/**
 * Seat math for /settings/team (G8).
 *
 * #392: the FORMULA and the numbers now live in `@loonext/shared` — this file
 * used to carry its own copy and said so three separate times ("mirroring the
 * API's seat formula", "mirror of the API's PLAN_SEATS", "Mirror of the API's
 * seatLimit"). Three comments naming the same hazard is a file asking to be
 * deleted. Starter 3 / Pro 15 had already moved twice, and it is a pricing
 * lever rather than an architectural fact.
 *
 * What stays here is the COUNTING, which is web-shaped: it walks the member
 * and invite lists this page already has in memory.
 */
export {
  PLAN_SEATS,
  seatLimit,
  canUpgradeSeats,
  seatUsage,
  type SeatUsage,
} from "@loonext/shared";

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
