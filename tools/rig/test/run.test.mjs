import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { main } from "../src/cli.mjs";
import { TOOLING_ROOT } from "../src/layout.mjs";
import { runCommand } from "../src/run.mjs";

const NODE = "/usr/bin/node";
const CLI = join(TOOLING_ROOT, "tools", "rig", "rigd", "src", "cli.ts");
const layout = { home: "/var/lib/loonext-rig" };
const at = Date.UTC(2026, 10, 1, 5, 0, 0);

test("a run is rigd's own run command, in a transient unit of its own under systemd", () => {
  const { command, args, env } = runCommand({ instance: "S25-2", runId: "S25-20261101050000-abc123", layout, systemd: true, node: NODE, now: at });
  assert.equal(command, "systemd-run");
  assert.deepEqual(args, [
    "--user",
    "--unit=loonext-rig-run-S25-2-20261101050000",
    "--wait",
    "--collect",
    "--quiet",
    "--pipe",
    "--property=TimeoutStopSec=10min",
    "--setenv=RIG_HOME=/var/lib/loonext-rig",
    "--setenv=PATH=/usr/bin:/usr/local/bin:/bin",
    NODE,
    CLI,
    "run",
    "S25-2",
    "--run-id",
    "S25-20261101050000-abc123",
  ]);
  assert.deepEqual(env, {});
});

test("without systemd a run is a plain child with the rig's home", () => {
  assert.deepEqual(runCommand({ instance: "D02p", layout, systemd: false, node: NODE }), {
    command: NODE,
    args: [CLI, "run", "D02p"],
    env: { RIG_HOME: "/var/lib/loonext-rig" },
  });
});

test("only a scenario id, and a plain run id, are taken", () => {
  for (const instance of ["", "s02", "S02; rm -rf /", "S25-0", "../S02", undefined]) {
    assert.throws(() => runCommand({ instance, layout, systemd: false }), /is not a scenario/, String(instance));
  }
  assert.throws(() => runCommand({ instance: "S02", runId: "../x", layout, systemd: false }), /run id/);
});

test("the rig has no run-on-a-schedule flag: rig run takes a scenario and a run id and nothing about when", async () => {
  const lines = [];
  assert.equal(await main([], { log: (line) => lines.push(line) }), 2);
  const usage = lines.join("\n");
  assert.match(usage, /rig run|run <scenario>/);
  assert.match(usage, /The rig runs nothing on a timer/);
  assert.doesNotMatch(usage, /--scheduled|timer install|every \d+ ?min/i);
});
