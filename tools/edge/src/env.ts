import type { RobotMailbox } from "./mailbox";
import type { RigUplink } from "./uplink";

/** The Workers rate-limit binding (`"type": "ratelimit"` in wrangler.jsonc). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Every credential is a Worker secret set by rig-cloud.yml or
 * rig-secrets.yml, and a missing one turns its feature off rather than
 * opening it.
 *
 * Each `TOKEN_SHA256_*` and `*_SECRET_SHA256` holds the lowercase hex SHA-256
 * of a 256-bit random value, never the value, so a leak of the edge's
 * secrets hands out no usable token.
 */
export interface Env {
  GUARD: Fetcher;
  UPLINK: DurableObjectNamespace<RigUplink>;
  MAILBOX: DurableObjectNamespace<RobotMailbox>;
  /** Absent in tests and local runs, where the limit is skipped. */
  EDGE_LIMITER?: RateLimiter;

  /** Base64 of the account's raw 32-byte Ed25519 webhook key. A plain var. */
  TELNYX_PUBLIC_KEY?: string;
  /** The robot's address on loonext.com. A plain var, kept out of git. */
  ROBOT_MAIL_ADDRESS?: string;
  /** The deployed commit, stamped by rig-cloud.yml. */
  GIT_SHA?: string;

  TOKEN_SHA256_RIG_API?: string;
  TOKEN_SHA256_ROBOT?: string;
  TOKEN_SHA256_DIAG?: string;
  TOKEN_SHA256_ADMIN?: string;
  TOKEN_SHA256_RIG?: string;
  TOKEN_SHA256_TRIAGE?: string;
  /** The secret segment of `/w/<secret>/...`. */
  ROBOT_WEBHOOK_SECRET_SHA256?: string;
  /** The secret segment of `/t/n/<secret>`. */
  NOTIFICATIONS_SECRET_SHA256?: string;

  /**
   * The existing Sentry project's ingest-only DSN (FA7: no new project). Its
   * events carry environment `synthetic`, which keeps notices that could not be
   * corroborated apart from production's own.
   */
  SENTRY_SYNTHETIC_DSN?: string;
  /** Production's API project: only the account signals and the rig's integrity alerts. */
  SENTRY_PROD_DSN?: string;

  /**
   * The sealed secret bundle, split because a Worker secret holds at most
   * 5 KB. `RIG_SECRET_BUNDLE_PARTS` names how many of `RIG_SECRET_BUNDLE_1..8`
   * belong to the current bundle, so a shorter bundle never picks up a stale
   * tail.
   */
  RIG_SECRET_BUNDLE_PARTS?: string;
  RIG_SECRET_BUNDLE_1?: string;
  RIG_SECRET_BUNDLE_2?: string;
  RIG_SECRET_BUNDLE_3?: string;
  RIG_SECRET_BUNDLE_4?: string;
  RIG_SECRET_BUNDLE_5?: string;
  RIG_SECRET_BUNDLE_6?: string;
  RIG_SECRET_BUNDLE_7?: string;
  RIG_SECRET_BUNDLE_8?: string;
}

export const UPLINK_NAME = "rig";
export const MAILBOX_NAME = "robot";

export function uplink(env: Env): DurableObjectStub<RigUplink> {
  return env.UPLINK.get(env.UPLINK.idFromName(UPLINK_NAME));
}

export function mailbox(env: Env): DurableObjectStub<RobotMailbox> {
  return env.MAILBOX.get(env.MAILBOX.idFromName(MAILBOX_NAME));
}
