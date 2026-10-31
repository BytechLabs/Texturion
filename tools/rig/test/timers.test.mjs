import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cronTimers } from "../src/cron.mjs";
import { installTimers, rigdScheduleCommand } from "../src/deploy.mjs";
import { CommandFailed, userManagerEnv } from "../src/exec.mjs";
import { TOOLING_ROOT } from "../src/layout.mjs";

const NODE = "/usr/bin/node";
const RIGD_CLI = join(TOOLING_ROOT, "tools", "rig", "rigd", "src", "cli.ts");

function withUnitDir(body) {
  const dir = mkdtempSync(join(tmpdir(), "rig-units-"));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("rigd's schedule is installed by rigd's own CLI in the tooling checkout", () => {
  const { command, args } = rigdScheduleCommand(NODE);
  assert.equal(command, NODE);
  assert.deepEqual(args, [RIGD_CLI, "schedule", "--install"]);
  assert.ok(existsSync(RIGD_CLI));
  assert.match(readFileSync(RIGD_CLI, "utf8"), /case "schedule":[\s\S]*values\.install/);
});

test("deploy installs the ref's cron timers first, then rigd's", () => {
  withUnitDir((unitDir) => {
    writeFileSync(join(unitDir, "loonext-rig-cron-c09.timer"), "stale");
    writeFileSync(join(unitDir, "loonext-rig-scenario-S02-0.timer"), "rigd's own");
    const calls = [];
    const lines = [];
    let rigdEnv;
    installTimers({
      timers: cronTimers(["* * * * *", "0 13 * * *"]),
      nodeBin: NODE,
      log: (line) => lines.push(line),
      unitDir,
      systemctl: (args) => {
        calls.push(["systemctl", ...args].join(" "));
        return { status: 0, stdout: "", stderr: "" };
      },
      runner: (command, args, options) => {
        calls.push([command, ...args].join(" "));
        rigdEnv = options.env;
        const timed = [{ id: "S02", instance: "S02-0", onCalendar: [] }, { id: "S20", instance: "S20-0", onCalendar: [] }];
        return { status: 0, stdout: JSON.stringify({ written: [], removed: [], timed, not_timed: [{ id: "K01", reason: "x" }] }), stderr: "" };
      },
    });

    assert.deepEqual(calls, [
      "systemctl disable --now loonext-rig-cron-c09.timer",
      "systemctl daemon-reload",
      "systemctl enable loonext-rig-cron-c00.timer loonext-rig-cron-c01.timer",
      "systemctl restart loonext-rig-cron-c00.timer loonext-rig-cron-c01.timer",
      `${NODE} ${RIGD_CLI} schedule --install`,
    ]);
    assert.deepEqual(rigdEnv, userManagerEnv());
    // The CLI removes only its own cron units; rigd's are rigd's to replace.
    assert.deepEqual(readdirSync(unitDir).sort(), [
      "loonext-rig-cron-c00.service",
      "loonext-rig-cron-c00.timer",
      "loonext-rig-cron-c01.service",
      "loonext-rig-cron-c01.timer",
      "loonext-rig-scenario-S02-0.timer",
    ]);
    assert.deepEqual(lines, ["crons: 2 timer(s)", "rigd: 2 scenario timer(s), 1 scenario(s) not timed"]);
  });
});

test("a rigd schedule that fails fails the deploy", () => {
  withUnitDir((unitDir) => {
    assert.throws(
      () =>
        installTimers({
          timers: [],
          nodeBin: NODE,
          log: () => {},
          unitDir,
          systemctl: () => ({ status: 0, stdout: "", stderr: "" }),
          runner: (command) => {
            throw new CommandFailed(command, 1, "schedule --install: rig.json has systemd off");
          },
        }),
      /exited with 1: schedule --install: rig\.json has systemd off/,
    );
  });
});
