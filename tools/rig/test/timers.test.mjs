import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { cronTimers } from "../src/cron.mjs";
import { activate, checkRigdSchedule, rigdScheduleCommand, SCHEMA_CHANGE_STOPS, SERVICE_UNITS } from "../src/deploy.mjs";
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

test("deploy installs the ref's cron timers, restarts the services, then installs rigd's", () => {
  withUnitDir((unitDir) => {
    writeFileSync(join(unitDir, "loonext-rig-cron-c09.timer"), "stale");
    writeFileSync(join(unitDir, "loonext-rig-scenario-S02-0.timer"), "rigd's own");
    const calls = [];
    const lines = [];
    let rigdEnv;
    activate({
      timers: cronTimers(["* * * * *", "0 13 * * *"]),
      sha: "abc123",
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
      `systemctl restart ${SERVICE_UNITS.join(" ")}`,
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
    assert.deepEqual(lines, [
      "crons: 2 timer(s)",
      `services restarted: ${SERVICE_UNITS.join(", ")}`,
      "rigd: 2 scenario timer(s), 1 scenario(s) not timed",
    ]);
  });
});

test("a rigd install that fails fails the deploy, after the services restarted", () => {
  withUnitDir((unitDir) => {
    const calls = [];
    assert.throws(
      () =>
        activate({
          timers: [],
          sha: "abc123",
          nodeBin: NODE,
          log: () => {},
          unitDir,
          systemctl: (args) => {
            calls.push(args.join(" "));
            return { status: 0, stdout: "", stderr: "" };
          },
          runner: (command) => {
            throw new CommandFailed(command, 1, "systemctl --user enable failed");
          },
        }),
      /abc123 is deployed and its services restarted, but rigd's schedule install failed.*exited with 1: systemctl --user enable failed/,
    );
    assert.equal(calls.at(-1), `restart ${SERVICE_UNITS.join(" ")}`);
  });
});

test("rigd's schedule is built into a scratch folder before anything changes, and the folder goes", () => {
  let seen;
  checkRigdSchedule({
    nodeBin: NODE,
    runner: (command, args) => {
      seen = { command, args };
      assert.ok(existsSync(args[3]));
      return { status: 0, stdout: "{}", stderr: "" };
    },
  });
  assert.equal(seen.command, NODE);
  assert.deepEqual(seen.args.slice(0, 3), [RIGD_CLI, "schedule", "--out"]);
  assert.equal(existsSync(seen.args[3]), false);
});

test("a rigd that cannot build its schedule refuses the deploy, naming the fix", () => {
  let out;
  assert.throws(
    () =>
      checkRigdSchedule({
        nodeBin: NODE,
        runner: (command, args) => {
          out = args[3];
          throw new CommandFailed(command, 1, "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@loonext/rig-robot'");
        },
      }),
    /rigd cannot build its schedule from .*, so nothing was changed \(run pnpm install there.*ERR_MODULE_NOT_FOUND/,
  );
  assert.equal(existsSync(out), false);
});

/** systemctl's unit pattern: `*` is any run of characters, the rest literal. */
function unitPattern(glob) {
  return new RegExp(`^${glob.split("*").map((part) => part.replace(/[.\\^$+?()[\]{}|]/g, "\\$&")).join(".*")}$`);
}

test("a schema change stops every timer either install writes", async () => {
  // rigd's own schedule from the real registry, every scenario taken as runnable.
  const rigd = (file) => pathToFileURL(join(TOOLING_ROOT, "tools", "rig", "rigd", "src", file)).href;
  const { buildSchedule } = await import(rigd("schedule.ts"));
  const { loadRegistry } = await import(rigd("registry.ts"));
  const registry = loadRegistry(join(TOOLING_ROOT, "tools", "rig", "scenarios.json"));
  const schedule = buildSchedule(registry, {
    window: { startHour: 4, hours: 6 },
    runnable: new Set(registry.scenarios.map((entry) => entry.id)),
    node: NODE,
    cli: RIGD_CLI,
    home: "/var/lib/loonext-rig",
  });
  const timers = [
    ...cronTimers(["* * * * *", "0 13 * * *"]).map((entry) => entry.timer),
    ...schedule.units.map((unit) => unit.name).filter((name) => name.endsWith(".timer")),
  ];
  assert.ok(schedule.units.some((unit) => unit.name.startsWith("loonext-rig-scenario-")));
  const patterns = SCHEMA_CHANGE_STOPS.map(unitPattern);
  for (const timer of timers) assert.ok(patterns.some((pattern) => pattern.test(timer)), `${timer} keeps running through a schema change`);
});
