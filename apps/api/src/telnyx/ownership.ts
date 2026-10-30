import type { Env } from "../env";
import { opsAlert } from "../observability/ops-alert";

/**
 * D142 — which Telnyx numbers this environment may act on.
 *
 * Production and the rig share ONE Telnyx account, and the number listing,
 * adoption and release paths all see every number in it. A number belongs to
 * exactly one partition, marked by its billing group:
 *
 *   TELNYX_BILLING_GROUP_ID unset (production)  owns ONLY numbers with NO group
 *   TELNYX_BILLING_GROUP_ID set (the rig)       owns ONLY numbers in that group
 *
 * Positive ownership on both sides, so neither environment ever flags, adopts
 * or deletes the other's numbers. Production numbers therefore never carry a
 * billing group (docs/deploy/04-telnyx.md).
 */

/** The `/health` capability that tells the rig's guard production enforces this rule. */
export const TELNYX_PARTITION_CAPABILITY = "telnyx-partition-v1";

/**
 * The fields of a Telnyx phone-number resource (`PhoneNumberDetailed`, the
 * shape both `GET /v2/phone_numbers` and `GET /v2/phone_numbers/{id}` return)
 * that the partition rule reads. Telnyx sends `billing_group_id: null` for a
 * number with no group; an absent field is read the same way.
 */
export interface TelnyxPartitionedNumber {
  id?: string;
  customer_reference?: string | null;
  billing_group_id?: string | null;
}

/**
 * True when `number` is in this environment's partition. A set-but-empty
 * variable owns nothing, rather than falling back to production's rule.
 */
export function ownsTelnyxNumber(
  env: Pick<Env, "TELNYX_BILLING_GROUP_ID">,
  number: TelnyxPartitionedNumber,
): boolean {
  const group = number.billing_group_id ?? null;
  const hasGroup = typeof group === "string" && group.length > 0;
  const partition = env.TELNYX_BILLING_GROUP_ID;
  if (partition === undefined) return !hasGroup;
  return hasGroup && partition.length > 0 && group === partition;
}

/**
 * The field every number order adds so the purchase lands in this partition.
 * Empty in production, which leaves the order body exactly as it was.
 */
export function partitionOrderFields(
  env: Pick<Env, "TELNYX_BILLING_GROUP_ID">,
): { billing_group_id?: string } {
  return env.TELNYX_BILLING_GROUP_ID === undefined
    ? {}
    : { billing_group_id: env.TELNYX_BILLING_GROUP_ID };
}

/**
 * How many hours apart the reconcile sweep repeats a standing mismatch page.
 * The sweep runs every 15 minutes and keeps no state, and `opsAlert` also
 * emails on every call when OPS_ALERT_EMAIL is set: paging on every pass would
 * be 96 copies a day of one problem that only a portal visit fixes. Six hours
 * is the liveness checker's re-alert interval.
 */
export const MISMATCH_SWEEP_ALERT_EVERY_HOURS = 6;

/**
 * True for the one sweep in each six-hour window that may page: the first
 * quarter hour of 00, 06, 12 and 18 UTC. Stateless, like the email posture
 * check's daily hour, and sized for the 15-minute trigger, whose scheduledTime
 * lands in that quarter hour exactly once.
 */
export function mismatchSweepAlertDue(now: Date): boolean {
  return (
    now.getUTCHours() % MISMATCH_SWEEP_ALERT_EVERY_HOURS === 0 &&
    now.getUTCMinutes() < 15
  );
}

/**
 * Numbers outside this partition that this environment has evidence are its
 * own: tagged to one of its companies, or claimed by one of its rows. In
 * production that is a customer's number that gained a billing group. Every
 * path here leaves it alone, so without this page it would be orphaned in
 * silence: never released, never adopted, never flagged. One alert covers the
 * whole batch. IDs only: phone numbers stay out of telemetry.
 */
export async function alertOwnershipMismatch(
  env: Env,
  numbers: readonly TelnyxPartitionedNumber[],
  where: string,
): Promise<void> {
  if (numbers.length === 0) return;
  const first = numbers[0];
  const summary =
    numbers.length === 1
      ? `Telnyx number ${first.id ?? "(no id)"} (customer_reference=` +
        `${first.customer_reference ?? "none"}) is this environment's but sits outside its partition`
      : `${numbers.length} Telnyx numbers that are this environment's sit outside its partition`;
  const listed = numbers
    .map(
      (number) =>
        `${number.id ?? "(no id)"} (customer_reference=${number.customer_reference ?? "none"}, ` +
        `billing_group_id=${number.billing_group_id ?? "none"})`,
    )
    .join("; ");
  await opsAlert(env, {
    key: "telnyx-ownership-mismatch",
    summary,
    detail:
      `Seen by ${where}: ${listed}. This environment owns ${
        env.TELNYX_BILLING_GROUP_ID === undefined
          ? "only numbers with no billing group"
          : `only billing group ${env.TELNYX_BILLING_GROUP_ID}`
      } (D142). Nothing here will release, adopt or flag these until that matches.`,
    action:
      "In the Telnyx portal, open each number and clear its billing group (production) " +
      "or set it back to this environment's group. Production numbers never carry one.",
    level: "error",
  });
}
