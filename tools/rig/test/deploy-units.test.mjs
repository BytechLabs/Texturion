import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  activate,
  checkRigdUnits,
  LEGACY_UNITS,
  migrateAndRestart,
  removeLegacyUnits,
  rigdUnitsCommand,
  RUN_UNITS,
  SCHEMA_CHANGE_STOPS,
  SERVICE_UNITS,
  stopForSchemaChange,
} from "../src/deploy.mjs";
import { deployHoldPath, holdForDeploy, readDeployHold } from "../src/deploy-hold.mjs";
import { CommandFailed, userManagerEnv } from "../src/exec.mjs";
import { TOOLING_ROOT } from "../src/layout.mjs";
import { runCommand } from "../src/run.mjs";

const NODE = "/usr/bin/node";
const RIGD_CLI = join(TOOLING_ROOT, "tools", "rig", "rigd", "src", "cli.ts");

/** A unit folder and, beside it, the rig's state folder. */
function withUnitDir(body) {
  const dir = mkdtempSync(join(tmpdir(), "rig-units-"));
  const state = mkdtempSync(join(tmpdir(), "rig-state-"));
  try {
    return body(dir, state);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
}

const ok = { status: 0, stdout: "", stderr: "" };

test("rigd's units are installed by rigd's own CLI in the tooling checkout", () => {
  const { command, args } = rigdUnitsCommand(NODE);
  assert.equal(command, NODE);
  assert.deepEqual(args, [RIGD_CLI, "units", "--install"]);
  assert.ok(existsSync(RIGD_CLI));
  assert.match(readFileSync(RIGD_CLI, "utf8"), /case "units":[\s\S]*values\.install/);
});

test("deploy installs no timer, and removes every one an earlier rig installed", () => {
  withUnitDir((unitDir, state) => {
    holdForDeploy(state, { sha: "abc123", ref: "main" });
    const legacy = [
      "loonext-rig-cron-c00.timer",
      "loonext-rig-cron-c00.service",
      "loonext-rig-scenario-S02.timer",
      "loonext-rig-scenario@.service",
      "loonext-rig-health.timer",
      "loonext-rig-health.service",
    ];
    const kept = ["loonext-rig-api.service", "loonext-rig-rigd.service", "loonext-rig-robotd.service"];
    for (const name of [...legacy, ...kept]) writeFileSync(join(unitDir, name), "[Unit]\n");
    const calls = [];
    const lines = [];
    let rigdEnv;
    activate({
      sha: "abc123",
      state,
      nodeBin: NODE,
      log: (line) => lines.push(line),
      unitDir,
      systemctl: (args) => {
        calls.push(args.join(" "));
        return ok;
      },
      runner: (command, args, options) => {
        calls.push([command, ...args].join(" "));
        rigdEnv = options.env;
        return ok;
      },
    });

    assert.deepEqual(calls, [
      "disable --now loonext-rig-cron-c00.timer",
      "disable --now loonext-rig-health.timer",
      "disable --now loonext-rig-scenario-S02.timer",
      "daemon-reload",
      `restart ${SERVICE_UNITS.join(" ")}`,
      `${NODE} ${RIGD_CLI} units --install`,
    ]);
    assert.deepEqual(rigdEnv, userManagerEnv());
    assert.deepEqual(readdirSync(unitDir).sort(), kept);
    // Nothing enabled or started that is a timer.
    for (const call of calls) assert.ok(!/^(?:enable|start|restart)\b.*\.timer/.test(call), call);
    assert.match(lines[0], /^timers removed: /);
    for (const name of legacy) assert.ok(lines[0].includes(name), `${name} is not reported removed`);
    assert.deepEqual(lines.slice(1), [
      `services restarted: ${SERVICE_UNITS.join(", ")}`,
      "rigd: units installed",
      "deploy hold released: abc123 serves, and runs may start again",
    ]);
    assert.equal(readDeployHold(state), null);
  });
});

test("a clean unit folder takes no systemctl call for timers at all", () => {
  withUnitDir((unitDir, state) => {
    const calls = [];
    activate({
      sha: "abc123",
      state,
      nodeBin: NODE,
      log: () => {},
      unitDir,
      systemctl: (args) => {
        calls.push(args.join(" "));
        return ok;
      },
      runner: () => ok,
    });
    assert.deepEqual(calls, [`restart ${SERVICE_UNITS.join(" ")}`]);
  });
});

test("removeLegacyUnits matches only the units the rig used to time, and names none of the rig's services", () => {
  for (const name of [
    "loonext-rig-cron-c03.timer",
    "loonext-rig-cron-c03.service",
    "loonext-rig-scenario-S25-2.timer",
    "loonext-rig-scenario@.service",
    "loonext-rig-health.timer",
    "loonext-rig-health.service",
  ]) {
    assert.ok(LEGACY_UNITS.test(name), name);
  }
  for (const name of [
    "loonext-rig-api.service",
    "loonext-rig-web.service",
    "loonext-rig-stack.service",
    "loonext-rig-stripe-listen.service",
    "loonext-rig-rigd.service",
    "loonext-rig-robotd.service",
    "loonext-rig-run-S02-20261101050000.service",
    "loonext-rig-rerun-S02-20261101050000-abc123.service",
  ]) {
    assert.ok(!LEGACY_UNITS.test(name), name);
  }
  assert.deepEqual(removeLegacyUnits({ unitDir: join(tmpdir(), "rig-no-such-folder"), systemctl: () => assert.fail("no folder, no call") }), []);
});

test("the tooling checkout ships no timer unit for the rig account", () => {
  const dir = join(TOOLING_ROOT, "tools", "rig", "box", "systemd", "user");
  const files = readdirSync(dir);
  assert.ok(files.includes("loonext-rig-api.service"));
  assert.deepEqual(files.filter((name) => /\.timer$/.test(name)), []);
  const bootstrap = readFileSync(join(TOOLING_ROOT, "tools", "rig", "box", "bootstrap.sh"), "utf8");
  assert.ok(!/loonext-rig-[\w@-]*\.timer/.test(bootstrap), "bootstrap.sh enables a rig timer");
  assert.ok(!/"\$units"\/\*\.timer/.test(bootstrap), "bootstrap.sh copies timer units");
});

test("a rigd install that fails fails the deploy, after the services restarted, and leaves the hold", () => {
  withUnitDir((unitDir, state) => {
    holdForDeploy(state, { sha: "abc123", ref: "main" });
    const calls = [];
    const activation = (runner) => ({
      sha: "abc123",
      state,
      nodeBin: NODE,
      log: () => {},
      unitDir,
      systemctl: (args) => {
        calls.push(args.join(" "));
        return ok;
      },
      runner,
    });
    const failing = () => {
      throw new CommandFailed("node", 1, "systemctl --user enable failed");
    };
    let message = "";
    assert.throws(
      () => activate(activation(failing)),
      (error) => {
        message = error.message;
        return /abc123 is deployed and its services restarted, but rigd's units install failed.*exited with 1: systemctl --user enable failed/.test(message);
      },
    );
    assert.equal(calls.at(-1), `restart ${SERVICE_UNITS.join(" ")}`);
    assert.equal(readDeployHold(state)?.sha, "abc123");

    // The way out it names is one that removes the hold: rigd's own install never does.
    assert.match(message, /run the same rig deploy again/);
    assert.ok(!message.includes("units --install"), message);
    assert.ok(message.includes(deployHoldPath(state)), message);
    activate(activation(() => ok));
    assert.equal(readDeployHold(state), null);
  });
});

test("without a hold, a failed rigd install names rigd's own install as the way out", () => {
  withUnitDir((unitDir, state) => {
    assert.throws(
      () =>
        activate({
          sha: "abc123",
          state,
          nodeBin: NODE,
          log: () => {},
          unitDir,
          systemctl: () => ok,
          runner: () => {
            throw new CommandFailed("node", 1, "systemctl --user enable failed");
          },
        }),
      /stay as the last install left them until "node tools\/rig\/rigd\/src\/cli\.ts units --install" succeeds/,
    );
  });
});

test("services that fail to restart leave the hold, so no run starts against them", () => {
  withUnitDir((unitDir, state) => {
    holdForDeploy(state, { sha: "abc123", ref: "main" });
    let rigdRan = false;
    assert.throws(
      () =>
        activate({
          sha: "abc123",
          state,
          nodeBin: NODE,
          log: () => {},
          unitDir,
          systemctl: (args) => {
            if (args[0] === "restart") throw new CommandFailed("systemctl", 1, "loonext-rig-api.service failed");
            return ok;
          },
          runner: () => {
            rigdRan = true;
            return ok;
          },
        }),
      /loonext-rig-api\.service failed/,
    );
    assert.equal(rigdRan, false);
    assert.equal(readDeployHold(state)?.sha, "abc123");
  });
});

test("a schema change holds the rig before it stops anything", () => {
  withUnitDir((_unitDir, state) => {
    const stops = [];
    stopForSchemaChange({
      state,
      sha: "abc123",
      ref: "main",
      log: () => {},
      systemctl: (args) => {
        stops.push({ args, held: readDeployHold(state) });
        return ok;
      },
    });
    assert.deepEqual(stops.map((stop) => stop.args), [["stop", ...RUN_UNITS], ["stop", ...SCHEMA_CHANGE_STOPS]]);
    assert.deepEqual(SCHEMA_CHANGE_STOPS, SERVICE_UNITS);
    assert.equal(stops[0].held?.sha, "abc123");
    assert.equal(stops[0].held?.ref, "main");
    assert.ok(existsSync(deployHoldPath(state)));
  });
});

test("a deploy holds the rig from before a schema change stops it until the restart is done", async () => {
  const unitDir = mkdtempSync(join(tmpdir(), "rig-units-"));
  const state = mkdtempSync(join(tmpdir(), "rig-state-"));
  try {
    const deployOf = async (plan, restart) => {
      const steps = [];
      const held = () => (readDeployHold(state) === null ? "" : " (held)");
      const prepared = await migrateAndRestart({
        plan,
        restart,
        state,
        sha: "abc123",
        ref: "main",
        log: () => {},
        migrate: () => steps.push(`migrate${held()}`),
        prepare: async () => {
          steps.push(`prepare${held()}`);
          return { record: { sha: "abc123" } };
        },
        systemd: {
          nodeBin: NODE,
          unitDir,
          systemctl: (args) => {
            if (args[0] === "stop" || args[0] === "restart") steps.push(`${args[0]}${held()}`);
            return ok;
          },
          runner: () => {
            steps.push(`rigd install${held()}`);
            return ok;
          },
        },
      });
      assert.deepEqual(prepared.record, { sha: "abc123" });
      return steps;
    };

    const migrate = { action: "migrate", reason: "2 new" };
    assert.deepEqual(await deployOf(migrate, true), ["stop (held)", "stop (held)", "migrate (held)", "prepare (held)", "restart (held)", "rigd install (held)"]);
    assert.equal(readDeployHold(state), null, "released once rigd's units are installed");
    assert.deepEqual(await deployOf({ action: "none", reason: "current" }, true), ["migrate", "prepare", "restart", "rigd install"]);
    // --no-restart stops nothing, so it holds nothing.
    assert.deepEqual(await deployOf(migrate, false), ["migrate", "prepare"]);
  } finally {
    rmSync(unitDir, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});

test("rigd's units are built into a scratch folder before anything changes, and the folder goes", () => {
  let seen;
  checkRigdUnits({
    nodeBin: NODE,
    runner: (command, args) => {
      seen = { command, args };
      assert.ok(existsSync(args[3]));
      return ok;
    },
  });
  assert.equal(seen.command, NODE);
  assert.deepEqual(seen.args.slice(0, 3), [RIGD_CLI, "units", "--out"]);
  assert.equal(existsSync(seen.args[3]), false);
});

test("a rigd that cannot build its units refuses the deploy, naming the fix", () => {
  let out;
  assert.throws(
    () =>
      checkRigdUnits({
        nodeBin: NODE,
        runner: (command, args) => {
          out = args[3];
          throw new CommandFailed(command, 1, "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@loonext/rig-robot'");
        },
      }),
    /rigd cannot build its units from .*, so nothing was changed \(run pnpm install there.*ERR_MODULE_NOT_FOUND/,
  );
  assert.equal(existsSync(out), false);
});

/** systemctl's unit pattern: `*` is any run of characters, the rest literal. */
function unitPattern(glob) {
  return new RegExp(`^${glob.split("*").map((part) => part.replace(/[.\\^$+?()[\]{}|]/g, "\\$&")).join(".*")}$`);
}

test("a schema change stops the runs `rig run` and a triage rerun started", async () => {
  const rigd = (file) => pathToFileURL(join(TOOLING_ROOT, "tools", "rig", "rigd", "src", file)).href;
  const { runStarter } = await import(rigd("daemon.ts"));
  const run = runCommand({ instance: "S25-2", layout: { home: "/var/lib/loonext-rig" }, systemd: true, node: NODE, now: Date.UTC(2026, 10, 1, 5, 0, 0) });
  const asked = `${/^--unit=(.+)$/.exec(run.args.find((arg) => arg.startsWith("--unit=")))[1]}.service`;
  const launched = [];
  runStarter({ home: { home: "/var/lib/loonext-rig", state: "/var/lib/loonext-rig/state" }, systemd: true }, (command, args) => {
    launched.push(args);
    return { unref: () => {} };
  })("S02");
  const rerun = `${/^--unit=(.+)$/.exec(launched[0].find((arg) => arg.startsWith("--unit=")))[1]}.service`;
  const patterns = RUN_UNITS.map(unitPattern);
  for (const unit of [asked, rerun]) assert.ok(patterns.some((pattern) => pattern.test(unit)), `${unit} keeps running through a schema change`);
});
