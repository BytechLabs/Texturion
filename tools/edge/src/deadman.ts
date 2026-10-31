import { HEARTBEAT_COMPONENTS, type HeartbeatComponent } from "@loonext/rig-protocol";

import { mailbox, uplink, type Env } from "./env";
import { type EdgeEvent, parseDsn, sendSentryEvent } from "./sentry";
import type { AlertTarget } from "./uplink";

/**
 * The dead-man, run by the 15-minute cron.
 *
 * A stale heartbeat goes to the synthetic project as
 * `['synthetic-infra', component]`, so one dead phone is one issue. Six hours
 * with no heartbeat at all is "dark", the one rig signal sent to production.
 *
 * It arms on the first heartbeat ever received. The edge is deployed before
 * the rig box exists, and paging production for a rig that was never built
 * would teach everyone to ignore the alert that matters.
 */

/** How long each heartbeat may be silent: a few missed beats, not one. */
export const STALE_AFTER_MS: Record<HeartbeatComponent, number> = {
  /** rigd beats every minute. */
  rig: 30 * 60 * 1000,
  /** The daily suite. */
  suite: 26 * 60 * 60 * 1000,
  /** The hourly cloud triage task, which beats even when it has nothing to do. */
  triage: 3 * 60 * 60 * 1000,
};

export const DARK_AFTER_MS = 6 * 60 * 60 * 1000;

/** A repeated synthetic fingerprint is suppressed this long, as the rig's relay does. */
const REPEAT_AFTER_MS = 6 * 60 * 60 * 1000;
const DARK_REPEAT_AFTER_MS = 24 * 60 * 60 * 1000;
/**
 * A send Sentry did not take is tried again after this long rather than on
 * every cron, so a Sentry outage cannot spend the day's budget in an hour.
 */
export const RETRY_FAILED_AFTER_MS = 60 * 60 * 1000;

export interface DeadmanReport {
  armed: boolean;
  stale: HeartbeatComponent[];
  dark: boolean;
  sent: string[];
}

function hours(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

export async function runDeadman(env: Env, now: number = Date.now()): Promise<DeadmanReport> {
  const rig = uplink(env);
  const view = await rig.deadman();
  const report: DeadmanReport = { armed: view.armedAt !== null, stale: [], dark: false, sent: [] };
  if (view.armedAt === null) return report;

  const due = (key: string, every: number) =>
    now - (view.alerts[key] ?? 0) >= every && now - (view.failures[key] ?? 0) >= RETRY_FAILED_AFTER_MS;
  // A DSN that is not configured costs no budget: it is not a send.
  const send = async (key: string, target: AlertTarget, dsn: string | undefined, event: EdgeEvent) => {
    if (!parseDsn(dsn)) {
      console.warn(`dead-man: no ${target} DSN, so ${key} was not reported`);
      await rig.bump(`deadman.no_dsn.${target}`);
      return;
    }
    if (!(await rig.takeSentryBudget(now, target))) return;
    if (await sendSentryEvent(dsn, event)) {
      await rig.noteAlert(key, now);
      report.sent.push(key);
    } else {
      await rig.noteAlertFailed(key, now);
    }
  };

  for (const component of HEARTBEAT_COMPONENTS) {
    const last = view.heartbeats[component] ?? view.armedAt;
    const silent = now - last;
    if (silent <= STALE_AFTER_MS[component]) continue;
    report.stale.push(component);
    if (!due(component, REPEAT_AFTER_MS)) continue;
    await send(component, "synthetic", env.SENTRY_SYNTHETIC_DSN, {
      fingerprint: ["synthetic-infra", component],
      level: "warning",
      environment: "synthetic",
      edgeSha: env.GIT_SHA,
      message: `Rig heartbeat stale: ${component} silent for ${hours(silent)}`,
      tags: { component },
      extra: {
        last_heartbeat_at: view.heartbeats[component] === null ? null : new Date(last).toISOString(),
        stale_after_ms: STALE_AFTER_MS[component],
      },
    });
  }

  const newest = Math.max(
    view.armedAt,
    ...HEARTBEAT_COMPONENTS.map((c) => view.heartbeats[c] ?? 0),
  );
  if (now - newest > DARK_AFTER_MS) {
    report.dark = true;
    if (due("synthetic-dark", DARK_REPEAT_AFTER_MS)) {
      await send("synthetic-dark", "production", env.SENTRY_PROD_DSN, {
        fingerprint: ["ops", "synthetic-dark"],
        level: "error",
        environment: "production",
        edgeSha: env.GIT_SHA,
        message: `The test rig has been dark for ${hours(now - newest)}`,
        extra: {
          detail: `No rig, suite or triage heartbeat since ${new Date(newest).toISOString()}.`,
          action:
            "Synthetic coverage has stopped. Check the rig box's power and network, then its uplink to loonext-rig-edge.",
        },
      });
    }
  }
  return report;
}

/** Everything the cron does. Each part is independent, so one failing cannot stop the rest. */
export async function scheduled(env: Env, now: number = Date.now()): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["mail heartbeat", () => mailbox(env).selfTest(now)],
    ["uplink tick", () => uplink(env).tick(now)],
    ["dead-man", () => runDeadman(env, now)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (cause) {
      console.error(`cron ${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}
