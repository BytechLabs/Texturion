/**
 * The guard's bindings and secrets (docs/RIG.md, FA3 and FA6-FA8).
 *
 * Every vendor key is optional on purpose: the guard is deployed before the
 * founder creates them, and a missing key must fail its routes closed with a
 * rule that says so, never take the Worker down.
 */
import type { EdgeForGuardMethods } from "@loonext/rig-protocol";

import type { GuardState } from "./index";

export interface Env {
  GUARD: DurableObjectNamespace<GuardState>;
  AI?: Ai;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  /** The edge's EdgeForGuard entrypoint: the robot mailbox's status. */
  EDGE?: EdgeForGuardMethods;

  /** FA3. The one extra Telnyx key, `nonprod-guard`. Full account power. */
  TELNYX_API_KEY?: string;
  /**
   * FA8: the existing send-only Resend key, reused. The guard's recipient
   * rules (vendors/resend.ts) confine what it may send to.
   */
  RESEND_API_KEY?: string;
  /** FA6. `fcm-rig-sender`, Firebase messaging role only. */
  FCM_SERVICE_ACCOUNT_JSON?: string;
  /** FA7: the existing production project's ingest-only DSN, for the isolation and key alerts. */
  SENTRY_PROD_DSN?: string;

  /** The edge's https origin, `loonext-rig-edge.<acct>.workers.dev`. Not in git. */
  EDGE_ORIGIN?: string;
  /** The robot's Email Routing address, `local@domain`. Not in git. */
  ROBOT_MAILBOX?: string;
  /** The secret segment of the edge's `/t/n/<secret>` notification path. */
  NOTIFICATION_PATH_SECRET?: string;

  /** The lowest documented default concurrent limit (wrangler.jsonc). */
  TELNYX_CONCURRENT_FLOOR?: string;
  SIGNAL_LATCH_RESET?: string;
}

/** What the policy reads, parsed from {@link Env} once per Durable Object instance. */
export interface GuardConfig {
  telnyxKey: string | null;
  resendKey: string | null;
  fcmServiceAccount: string | null;
  sentryProdDsn: string | null;
  edgeOrigin: string | null;
  robotMailbox: string | null;
  notificationSecret: string | null;
  /**
   * The floor of the concurrency proof ladder (state/concurrency.ts). Null when
   * unparseable, which refuses every paid dial (admission.limit_unknown).
   */
  concurrentFloor: number | null;
  signalLatchReset: string;
}

function present(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A positive integer, or null for anything else ("unknown", empty, "0", "2.5"). */
export function parseConcurrentLimit(value: string | undefined): number | null {
  const text = value?.trim() ?? "";
  if (!/^[1-9]\d{0,3}$/.test(text)) return null;
  return Number(text);
}

/** The edge origin as `https://host`, or null when it is not a bare https origin. */
export function parseEdgeOrigin(value: string | undefined): string | null {
  const text = present(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.hash || url.username) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function readConfig(env: Env): GuardConfig {
  return {
    telnyxKey: present(env.TELNYX_API_KEY),
    resendKey: present(env.RESEND_API_KEY),
    fcmServiceAccount: present(env.FCM_SERVICE_ACCOUNT_JSON),
    sentryProdDsn: present(env.SENTRY_PROD_DSN),
    edgeOrigin: parseEdgeOrigin(env.EDGE_ORIGIN),
    robotMailbox: present(env.ROBOT_MAILBOX)?.toLowerCase() ?? null,
    notificationSecret: present(env.NOTIFICATION_PATH_SECRET),
    concurrentFloor: parseConcurrentLimit(env.TELNYX_CONCURRENT_FLOOR),
    signalLatchReset: present(env.SIGNAL_LATCH_RESET) ?? "",
  };
}
