import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { changeLock } from "../src/lock.mjs";

const run = promisify(execFile);
const linux = { skip: process.platform !== "linux" };

function lockPath(t) {
  const directory = mkdtempSync(join(tmpdir(), "rig-lock-"));
  t.after(() => rmSync(directory, { recursive: true }));
  return join(directory, "rig.lock");
}

test("only the owner can release a fresh rig lock", linux, (t) => {
  const path = lockPath(t);
  assert.match(changeLock(path, "lock", "calls"), /^Rig locked by calls/);
  assert.throws(() => changeLock(path, "lock", "help"), /calls holds the rig/);
  assert.throws(() => changeLock(path, "unlock", "help"), /calls holds the lock/);
  assert.equal(changeLock(path, "unlock", "calls"), "Rig unlocked by calls.");
  assert.equal(changeLock(path, "unlock", "calls"), "Rig is already unlocked.");
});

test("one worker can replace an expired lock even when several try", linux, async (t) => {
  const path = lockPath(t);
  changeLock(path, "lock", "previous");
  const past = new Date(Date.now() - 91 * 60 * 1000);
  utimesSync(path, past, past);
  const script = `import { changeLock } from ${JSON.stringify(new URL("../src/lock.mjs", import.meta.url).href)};
    console.log(changeLock(process.argv[1], "lock", process.argv[2]));`;
  const results = await Promise.allSettled(["calls", "help"].map((owner) =>
    run(process.execPath, ["--input-type=module", "--eval", script, path, owner]),
  ));
  const winner = results.find((result) => result.status === "fulfilled");
  const loser = results.find((result) => result.status === "rejected");
  const [owner] = readFileSync(path, "utf8").split(" ");
  assert.match(winner?.value.stdout ?? "", new RegExp(`Rig locked by ${owner}`));
  assert.match(loser?.reason.stderr ?? "", new RegExp(`${owner} holds the rig`));
});
