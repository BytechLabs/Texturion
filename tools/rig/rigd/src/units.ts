/**
 * The systemd user units rigd keeps beside the `rig` CLI's own
 * (tools/rig/box/systemd/user): the two daemons, `loonext-rig-rigd` and
 * `loonext-rig-robotd`. There is no timer here and none anywhere on the rig:
 * a scenario run starts when someone asks for it (`rig run`, or
 * `triage.rerun` through a transient unit of its own).
 *
 * They are user units with RIG_HOME in the environment and the tooling
 * checkout's node and paths.
 */
import { dirname } from "node:path";

export interface UnitOptions {
  /** e.g. /usr/local/bin/node */
  node: string;
  /** Absolute path of tools/rig/rigd/src/cli.ts on the rig. */
  cli: string;
  /** RIG_HOME, e.g. /var/lib/loonext-rig. */
  home: string;
}

export interface Unit {
  name: string;
  content: string;
}

/** The node the units run comes first, so `pnpm` and other `#!/usr/bin/env node` tools find it too. */
function environment(options: UnitOptions): string[] {
  const path = [...new Set([dirname(options.node), "/usr/local/bin", "/usr/bin", "/bin"])].join(":");
  return [`Environment=RIG_HOME=${options.home}`, `Environment=PATH=${path}`];
}

export function buildUnits(options: UnitOptions): Unit[] {
  const service = (name: string, description: string, exec: string, after: string): Unit => ({
    name,
    content: [
      "[Unit]",
      `Description=${description}`,
      `After=${after}`,
      "",
      "[Service]",
      ...environment(options),
      `ExecStart=${exec}`,
      "Restart=always",
      "RestartSec=5s",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n"),
  });
  const robotMain = options.cli.replace(/rigd[\\/]src[\\/]cli\.ts$/, "robot/src/main.ts");
  return [
    service(
      "loonext-rig-rigd.service",
      "Loonext rig: rigd (uplink, lease watchdog, Sentry relay, secret delivery)",
      `${options.node} ${options.cli} daemon`,
      "loonext-rig-stack.service",
    ),
    service(
      "loonext-rig-robotd.service",
      "Loonext rig: robotd (ROBOT-1, ROBOT-2 and STRANGER-1)",
      `${options.node} ${robotMain}`,
      "loonext-rig-rigd.service",
    ),
  ];
}
