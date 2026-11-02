import { mailbox, uplink, type Env } from "./env";

/**
 * Everything the edge's Cloudflare cron does. Each part is independent, so
 * one failing cannot stop the other.
 *
 * - The mail heartbeat proves the mailbox still writes and reads; the guard
 *   refuses a mail to the robot while it is stale (tools/guard/src/state/mail.ts).
 * - The uplink tick expires and purges what the edge remembers, and pings the rig.
 *
 * Nothing here alerts on a quiet rig: the rig runs nothing on a timer, so no
 * silence is a fault (docs/RIG.md, D142).
 */
export async function scheduled(env: Env, now: number = Date.now()): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["mail heartbeat", () => mailbox(env).selfTest(now)],
    ["uplink tick", () => uplink(env).tick(now)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (cause) {
      console.error(`cron ${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}
