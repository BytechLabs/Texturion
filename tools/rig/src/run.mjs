/**
 * `rig run <scenario>[-<variant>] [--run-id <id>]`: one scenario run, asked
 * for. It is rigd's own `run` command (tools/rig/rigd/src/cli.ts), which takes
 * the guard lease, judges the run and records its verdict and evidence. Nothing
 * starts a run on a timer.
 *
 * Under systemd the run gets a transient unit of its own, `loonext-rig-run-*`,
 * so a schema-change deploy can stop it and let it release its lease's undos
 * (deploy.mjs RUN_UNITS); without systemd it is a plain child.
 */
import { dirname, join } from "node:path";

import { TOOLING_ROOT } from "./layout.mjs";

const INSTANCE = /^[A-Z]{1,3}\d{2,3}[a-z]?(?:-[1-9]\d?)?$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** The command that makes one run, for the caller to start and wait on. */
export function runCommand({ instance, runId, layout, systemd, node = process.execPath, root = TOOLING_ROOT, now = Date.now() }) {
  if (!INSTANCE.test(instance ?? "")) throw new Error(`rig run: "${instance ?? ""}" is not a scenario like S20, D02p or S25-2`);
  if (runId !== undefined && !RUN_ID.test(runId)) throw new Error("rig run: a run id is letters, digits, - and _");
  const cli = join(root, "tools", "rig", "rigd", "src", "cli.ts");
  const args = [cli, "run", instance, ...(runId === undefined ? [] : ["--run-id", runId])];
  if (!systemd) return { command: node, args, env: { RIG_HOME: layout.home } };
  const path = [...new Set([dirname(node), "/usr/local/bin", "/usr/bin", "/bin"])].join(":");
  const stamp = new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return {
    command: "systemd-run",
    args: [
      "--user",
      `--unit=loonext-rig-run-${instance}-${stamp}`,
      "--wait",
      "--collect",
      "--quiet",
      "--pipe",
      "--property=TimeoutStopSec=10min",
      `--setenv=RIG_HOME=${layout.home}`,
      `--setenv=PATH=${path}`,
      node,
      ...args,
    ],
    env: {},
  };
}
