import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { syncUserUnits } from "../src/deploy.mjs";
import { TOOLING_ROOT } from "../src/layout.mjs";
import { waitForStackUnit } from "../src/stack-unit.mjs";
import { listStackContainers, notReadyBecause, waitForStack } from "../src/supabase.mjs";

const UNITS = join(TOOLING_ROOT, "tools", "rig", "box", "systemd", "user");
const unit = (name) => readFileSync(join(UNITS, name), "utf8");

/** A clock the sleeps move, so a bounded wait runs in no time. */
function clock() {
  let at = 0;
  return { now: () => at, sleep: async (ms) => void (at += ms) };
}

const container = (name, state, health = null) => ({ name, state, health });

test("docker ps lines become a name, a state and the healthcheck's answer", () => {
  const stdout = [
    "supabase_db_Loonext\trunning\tUp 13 seconds (health: starting)",
    "supabase_auth_Loonext\trunning\tUp 4 minutes (healthy)",
    "supabase_rest_Loonext\trunning\tUp 4 minutes",
    "supabase_kong_Loonext\trunning\tUp 3 seconds (unhealthy)",
    "supabase_studio_Loonext\texited\tExited (0) 2 hours ago",
    "",
  ].join("\n");
  const calls = [];
  const listed = listStackContainers("Loonext", (command, args) => {
    calls.push([command, ...args]);
    return { status: 0, stdout };
  });
  assert.deepEqual(listed, [
    container("supabase_db_Loonext", "running", "starting"),
    container("supabase_auth_Loonext", "running", "healthy"),
    container("supabase_rest_Loonext", "running", null),
    container("supabase_kong_Loonext", "running", "unhealthy"),
    container("supabase_studio_Loonext", "exited", null),
  ]);
  assert.ok(calls[0].includes("label=com.supabase.cli.project=Loonext"), "only this project's containers");
  assert.deepEqual(listStackContainers("Loonext", () => ({ status: 1, stdout: "" })), []);
});

test("only a running container that is starting or unhealthy, or one restarting, is waited for", () => {
  assert.equal(notReadyBecause(container("a", "running", "starting")), "starting");
  assert.equal(notReadyBecause(container("a", "running", "unhealthy")), "unhealthy");
  assert.equal(notReadyBecause(container("a", "restarting")), "restarting");
  assert.equal(notReadyBecause(container("a", "running", "healthy")), null);
  assert.equal(notReadyBecause(container("a", "running", null)), null);
  assert.equal(notReadyBecause(container("a", "exited")), null, "supabase start starts a stopped one");
});

test("the stack wait returns as soon as the database turns healthy, and says what it waited for", async () => {
  const time = clock();
  const answers = [
    [container("supabase_db_Loonext", "running", "starting"), container("supabase_rest_Loonext", "running")],
    [container("supabase_db_Loonext", "running", "starting"), container("supabase_rest_Loonext", "running")],
    [container("supabase_db_Loonext", "running", "healthy"), container("supabase_rest_Loonext", "running")],
  ];
  const lines = [];
  let polls = 0;
  await waitForStack("Loonext", { ...time, list: () => answers[Math.min(polls++, answers.length - 1)], log: (line) => lines.push(line) });
  assert.equal(polls, 3);
  assert.deepEqual(lines, ["stack: waiting for supabase_db_Loonext"]);
  assert.equal(time.now(), 4_000, "two polls apart");
});

test("a stack with nothing running, or already healthy, is not waited for", async () => {
  const time = clock();
  await waitForStack("Loonext", { ...time, list: () => [] });
  await waitForStack("Loonext", { ...time, list: () => [container("supabase_db_Loonext", "exited")] });
  await waitForStack("Loonext", { ...time, list: () => [container("supabase_db_Loonext", "running", "healthy")] });
  assert.equal(time.now(), 0);
});

test("a database still starting at the bound fails, naming it and where to look", async () => {
  const time = clock();
  await assert.rejects(
    waitForStack("Loonext", {
      ...time,
      timeoutMs: 10_000,
      list: () => [container("supabase_db_Loonext", "running", "starting")],
    }),
    (error) => {
      assert.match(error.message, /the database supabase_db_Loonext was still not ready after 10 s: supabase_db_Loonext \(starting\)/);
      assert.match(error.message, /docker logs supabase_db_Loonext/);
      return true;
    },
  );
  assert.ok(time.now() >= 10_000 && time.now() < 20_000, "the wait is bounded");
});

test("a service other than the database that stays unhealthy fails as the stack", async () => {
  await assert.rejects(
    waitForStack("Loonext", {
      ...clock(),
      timeoutMs: 4_000,
      list: () => [container("supabase_db_Loonext", "running", "healthy"), container("supabase_auth_Loonext", "running", "unhealthy")],
    }),
    /rig stack: the stack was still not ready after 4 s: supabase_auth_Loonext \(unhealthy\)/,
  );
});

test("stack wait passes once the unit is active, through activating while it retries", async () => {
  const time = clock();
  const states = ["activating", "activating", "active"];
  let polls = 0;
  await waitForStackUnit({ ...time, state: () => states[polls++] });
  assert.equal(polls, 3);
});

test("stack wait fails at once for a unit that gave up or was never started, with where to look", async () => {
  for (const state of ["failed", "inactive", ""]) {
    await assert.rejects(waitForStackUnit({ ...clock(), state: () => state }), (error) => {
      assert.match(error.message, new RegExp(`loonext-rig-stack.service is ${state || "unknown"}, not up`));
      assert.match(error.message, /journalctl --user -u loonext-rig-stack.service/);
      return true;
    });
  }
});

test("stack wait is bounded for a unit that stays activating", async () => {
  const time = clock();
  await assert.rejects(waitForStackUnit({ ...time, timeoutMs: 60_000, state: () => "activating" }), /still starting after 1 min/);
  assert.ok(time.now() >= 60_000 && time.now() < 70_000);
});

test("the stack unit retries a failed start, and the API and web units wait for it instead of requiring it", () => {
  const stack = unit("loonext-rig-stack.service");
  assert.match(stack, /^Restart=on-failure$/m);
  assert.match(stack, /^RestartSec=\d+s$/m);
  assert.match(stack, /^StartLimitBurst=\d+$/m);
  assert.match(stack, /^ExecStart=.* stack up$/m);
  for (const name of ["loonext-rig-api.service", "loonext-rig-web.service"]) {
    const text = unit(name);
    assert.match(text, /^Wants=loonext-rig-stack\.service$/m, name);
    assert.match(text, /^After=.*loonext-rig-stack\.service/m, name);
    assert.ok(!/^Requires=/m.test(text), `${name}: Requires= fails the unit for good when the stack's first start fails`);
    assert.match(text, /^ExecStartPre=.* stack wait$/m, name);
    assert.match(text, /^TimeoutStartSec=\d+min$/m, `${name}: the wait outlasts systemd's 90 s default`);
    assert.match(text, /^Restart=on-failure$/m, name);
  }
});

test("syncUserUnits writes only the units that differ and reloads once", () => {
  const source = mkdtempSync(join(tmpdir(), "rig-unit-src-"));
  const target = mkdtempSync(join(tmpdir(), "rig-unit-dst-"));
  try {
    writeFileSync(join(source, "loonext-rig-api.service"), "new api\n");
    writeFileSync(join(source, "loonext-rig-web.service"), "same web\n");
    writeFileSync(join(source, "notes.txt"), "not a unit\n");
    writeFileSync(join(target, "loonext-rig-api.service"), "old api\n");
    writeFileSync(join(target, "loonext-rig-web.service"), "same web\n");
    const calls = [];
    const systemctl = (args) => calls.push(args.join(" "));

    assert.deepEqual(syncUserUnits({ source, unitDir: target, systemctl }), ["loonext-rig-api.service"]);
    assert.equal(readFileSync(join(target, "loonext-rig-api.service"), "utf8"), "new api\n");
    assert.deepEqual(calls, ["daemon-reload"]);

    assert.deepEqual(syncUserUnits({ source, unitDir: target, systemctl }), []);
    assert.deepEqual(calls, ["daemon-reload"], "nothing changed, nothing reloaded");
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
