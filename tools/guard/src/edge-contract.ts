/**
 * The edge's side of the contract, mirrored from tools/edge/src/guard.ts and
 * tools/edge/src/mailbox.ts until @loonext/rig-protocol carries it. Keep the
 * two copies equal; a field renamed on one side is a call that silently
 * stops working.
 */

/** POST /detach: strangers flooded an owned number. */
export interface DetachRequest {
  e164: string;
  /** Stranger calls and texts to it inside the window. */
  strangers: number;
  window_ms: number;
}

/** POST /halt: a corroborated account signal. */
export interface HaltRequest {
  signal: string;
  notice_id: string | null;
  /** `signature`: Telnyx signed the notice within five minutes, and it names a type enabled on the account. */
  corroborated_by: "balance" | "signature" | "account_refused";
  received_at: string;
}

export const CORROBORATIONS: readonly HaltRequest["corroborated_by"][] = ["balance", "signature", "account_refused"];

/** What EdgeForGuard.mailStatus() answers. */
export interface MailStatus {
  /** The mailbox's last proven write: a stored mail or the cron's self-test. */
  heartbeat_at: string | null;
  last_received_at: string | null;
  received: number;
  stored: number;
  store_failed: number;
  /** The newest mail by `+tag`. */
  recent: { tag: string | null; received_at: string }[];
}

/** The edge's named entrypoint, over the `EDGE` service binding. */
export interface EdgeForGuard {
  mailStatus(): Promise<MailStatus>;
}

export const STANDING_ROLES = [
  "ROBOT-1",
  "ROBOT-2",
  "STRANGER-1",
  "DEV-W1",
  "DEV-W2",
  "DEV-A1",
  "DEV-C1",
  "DEV-E1",
] as const;

export type StandingRole = (typeof STANDING_ROLES)[number];

/** GET /partition's `standing`, beside the protocol's Partition fields. */
export interface StandingEntry {
  role: StandingRole;
  e164: string;
  telnyx_phone_number_id: string;
  messaging_profile_id: string | null;
}
