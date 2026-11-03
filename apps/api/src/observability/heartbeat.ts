/**
 * `ops_heartbeat`: something that should keep happening did (D146). PostHog's
 * "Heartbeat overdue" alert fires for any key whose last heartbeat is older
 * than the `grace_minutes` it carried, so each key states its own patience
 * here, where it is sent.
 *
 * A heartbeat says that a trigger fired or a channel carried something. A job
 * that throws is an exception, not a missing heartbeat.
 */
import type { Env } from "../env";
import { captureEvent, SYSTEM_DISTINCT_ID, type WaitUntil } from "./capture";

/**
 * Every cron trigger in wrangler.jsonc, with how long it may stay silent: its
 * cadence plus room for a late or skipped run. `CRON_JOBS` in index.ts is
 * keyed by this, so a trigger cannot be added without saying what its silence
 * means. The longest grace must stay inside the alert's 35-day window.
 */
export const CRON_GRACE_MINUTES = {
  "* * * * *": 21,
  "*/5 * * * *": 30,
  "*/15 * * * *": 60,
  "0 * * * *": 120,
  "30 * * * *": 150,
  "20 * * * *": 180,
  "40 * * * *": 180,
  "25 * * * *": 180,
  "0 13 * * *": 1800,
  "10 13 * * *": 1800,
  "0 14 * * *": 1800,
  "0 15 * * *": 1800,
  "45 15 * * *": 1800,
  "30 15 * * *": 1800,
  "15 */6 * * *": 540,
  "35 14 1 * *": 47_520,
} as const;

export type CronSchedule = keyof typeof CRON_GRACE_MINUTES;

/**
 * The delivery paths, beating when they carry something. Long graces on
 * purpose: at today's traffic a quiet night is normal, and an alert that cries
 * wolf is one nobody reads.
 */
export const CHANNEL_GRACE_MINUTES = {
  "channel:resend-send": 420,
  "channel:telnyx-send": 420,
  "channel:telnyx-webhook": 780,
} as const;

export type Channel = keyof typeof CHANNEL_GRACE_MINUTES;

export function isCronSchedule(cron: string): cron is CronSchedule {
  return Object.hasOwn(CRON_GRACE_MINUTES, cron);
}

/**
 * `cron:0_13_*_*_*` for `0 13 * * *`. The spaces go because the property
 * scrubber reads five words as prose and drops them.
 */
export function cronHeartbeatKey(cron: CronSchedule): string {
  return `cron:${cron.replaceAll(" ", "_")}`;
}

export function cronHeartbeat(
  env: Env,
  cron: CronSchedule,
  waitUntil?: WaitUntil,
): Promise<void> {
  return captureEvent(
    env,
    "ops_heartbeat",
    SYSTEM_DISTINCT_ID,
    { key: cronHeartbeatKey(cron), grace_minutes: CRON_GRACE_MINUTES[cron] },
    waitUntil,
  );
}

/** Best effort: a channel's work never waits on, or fails because of, this. */
export function channelHeartbeat(
  env: Env,
  channel: Channel,
  waitUntil?: WaitUntil,
): void {
  void captureEvent(
    env,
    "ops_heartbeat",
    SYSTEM_DISTINCT_ID,
    { key: channel, grace_minutes: CHANNEL_GRACE_MINUTES[channel] },
    waitUntil,
  );
}
