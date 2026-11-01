import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  AUDIO_SCRIPT,
  FAST_SWEEP_MS,
  STEADY_SWEEP_MS,
  createAudioMuter,
  parseHelperLine,
  parseHelperOutput,
  persistentHelper,
  processTree,
  sessionsOf,
  summarise,
} from "../src/audio-mute.mjs";
import { loadContract, rigPaths } from "../src/config.mjs";
import { createDevices } from "../src/emulator.mjs";
import { audioSilenced, healthReport } from "../src/host-facts.mjs";

const contract = loadContract();

// The launcher 100 spawns qemu 200, which has a crashpad child 300; 900 is another emulator's.
const TABLE = [
  { pid: 4, ppid: 0, name: "System" },
  { pid: 100, ppid: 50, name: "emulator.exe" },
  { pid: 200, ppid: 100, name: "qemu-system-x86_64.exe" },
  { pid: 300, ppid: 200, name: "crashpad_handler.exe" },
  { pid: 900, ppid: 50, name: "qemu-system-x86_64.exe" },
  { pid: 50, ppid: 4, name: "hostd node.exe" },
];

const ok = (value) => ({ code: 0, stdout: `${JSON.stringify(value)}\r\n`, stderr: "" });

/** A stand-in for powershell.exe running emulator-audio.ps1: it records each call. */
function fakeShell({ sessions = () => [], table = TABLE } = {}) {
  const calls = [];
  const exec = async (file, args) => {
    assert.equal(file, "powershell.exe");
    const at = (flag) => args[args.indexOf(flag) + 1];
    const call = { action: at("-Action"), pids: at("-Pids") === undefined ? undefined : at("-Pids").split(",").map(Number) };
    calls.push(call);
    if (call.action === "processes") return ok(table);
    return ok({ sessions: sessions(call) });
  };
  return { exec, calls, of: (action) => calls.filter((call) => call.action === action) };
}

test("the emulator's process tree is its launcher, qemu and their children, and nothing else", () => {
  assert.deepEqual(processTree(TABLE, [100]), [100, 200, 300]);
  assert.deepEqual(processTree(TABLE, [200]), [200, 300]);
  assert.deepEqual(processTree(TABLE, [100, 200]), [100, 200, 300]);
  // The launcher has exited; Windows keeps its pid as the child's ppid.
  assert.deepEqual(processTree(TABLE.filter((row) => row.pid !== 100), [100]), [100, 200, 300]);
  assert.deepEqual(processTree(TABLE, [50]), [50, 100, 200, 300, 900], "a root's whole subtree");
  assert.deepEqual(processTree(TABLE, []), []);
});

test("the idle process and the kernel are never a root, so the tree cannot swallow every process", () => {
  const rows = [...TABLE, { pid: 7, ppid: 0, name: "Registry" }, { pid: 0, ppid: 0, name: "System Idle Process" }];
  assert.deepEqual(processTree(rows, [0, 4]), []);
  assert.deepEqual(processTree(rows, [0, 4, 200]), [200, 300]);
  assert.deepEqual(processTree(rows, [-1, 1.5, NaN]), []);
});

test("only sessions of the tree's pids are claimed, and the state is the mute read back", () => {
  const sessions = [
    { pid: 200, muted: true, state: "active" },
    { pid: 900, muted: false, state: "active" },
    { pid: 0, muted: false, state: "inactive" },
    { muted: false },
  ];
  assert.deepEqual(sessionsOf(sessions, [100, 200, 300]), [sessions[0]]);
  assert.deepEqual(sessionsOf(undefined, [200]), []);
  assert.deepEqual(summarise([]), { state: "waiting", sessions: 0, muted: 0 });
  assert.deepEqual(summarise([{ muted: true }, { muted: true }]), { state: "muted", sessions: 2, muted: 2 });
  assert.deepEqual(summarise([{ muted: true }, { muted: false }]), { state: "unmuted", sessions: 2, muted: 1 });
  assert.equal(summarise([{ muted: "yes" }]).state, "unmuted", "only true counts as muted");
});

test("the helper's output is one JSON line, and its errors become errors", () => {
  assert.deepEqual(parseHelperOutput({ code: 0, stdout: '{"sessions":[]}\r\n' }), { sessions: [] });
  assert.deepEqual(parseHelperOutput({ code: 0, stdout: "noise\n[1]\n" }), [1]);
  assert.throws(() => parseHelperOutput({ code: 1, stdout: '{"error":"Class not registered"}' }), /audio helper: Class not registered/);
  assert.throws(() => parseHelperOutput({ code: 1, stdout: "", stderr: "boom" }), /no JSON \(exit 1\): boom/);
  assert.throws(() => parseHelperOutput({ code: 0, stdout: "not json" }), /no JSON/);
  assert.throws(() => parseHelperOutput({ code: 3, stdout: '{"sessions":[]}' }), /exited 3/);
});

test("a sweep mutes the sessions of the process tree and reports what they read back", async () => {
  const shell = fakeShell({ sessions: () => [{ pid: 200, muted: true, state: "active" }, { pid: 900, muted: false, state: "active" }] });
  const muter = createAudioMuter({ exec: shell.exec });
  const result = await muter.sweep([100]);
  assert.deepEqual(shell.of("mute").map((call) => call.pids), [[100, 200, 300]], "never the other emulator's pid");
  assert.equal(result.state, "muted");
  assert.deepEqual([result.sessions, result.muted], [1, 1], "the other emulator's session is not counted");
  assert.deepEqual(result.pids, [100, 200, 300]);
  const read = await muter.sweep([100], { mute: false });
  assert.equal(shell.of("status").length, 1, "mute: false only reads");
  assert.equal(read.state, "muted");
});

test("a session the helper could not mute is reported as unmuted", async () => {
  const shell = fakeShell({ sessions: () => [{ pid: 200, muted: false, state: "active" }] });
  assert.equal((await createAudioMuter({ exec: shell.exec }).sweep([100])).state, "unmuted");
});

test("the process table is read once while sessions exist, and again while none do", async () => {
  let clock = 0;
  let present = false;
  const shell = fakeShell({ sessions: () => (present ? [{ pid: 200, muted: true }] : []) });
  const muter = createAudioMuter({ exec: shell.exec, now: () => clock, treeTtlMs: 10_000 });
  await muter.sweep([100]);
  await muter.sweep([100]);
  assert.equal(shell.of("processes").length, 2, "no session yet: the tree may still be growing");
  present = true;
  await muter.sweep([100]);
  await muter.sweep([100]);
  assert.equal(shell.of("processes").length, 3, "cached once a session is muted");
  clock += 10_001;
  await muter.sweep([100]);
  assert.equal(shell.of("processes").length, 4, "re-read after the ttl, so a new child is found");
  await muter.sweep([200]);
  assert.equal(shell.of("processes").length, 5, "re-read when the roots change");
});

/** Runs the watcher's loop with a clock that only the loop's sleeps advance; stops after `rounds` sweeps. */
async function runWatch({ rounds, roots, sessionsAt, shellOptions = {} }) {
  const sleeps = [];
  const results = [];
  let round = 0;
  const shell = fakeShell({ sessions: () => sessionsAt(round) });
  const muter = createAudioMuter({
    exec: shell.exec,
    sleep: async (ms) => {
      sleeps.push(ms);
      round += 1;
    },
    ...shellOptions,
  });
  let ended = 0;
  const watcher = muter.watch({
    roots: () => (round >= rounds ? null : roots(round)),
    onResult: (result) => results.push(result),
    onEnd: () => {
      ended += 1;
    },
  });
  await watcher.done;
  return { sleeps, results, shell, ended };
}

test("it retries quickly until a session exists, then settles to a steady check", async () => {
  const run = await runWatch({
    rounds: 6,
    roots: () => [100],
    sessionsAt: (round) => (round < 3 ? [] : [{ pid: 200, muted: true, state: "active" }]),
  });
  assert.deepEqual(run.results.map((result) => result.state), ["waiting", "waiting", "waiting", "muted", "muted", "muted"]);
  assert.deepEqual(run.sleeps, [FAST_SWEEP_MS, FAST_SWEEP_MS, FAST_SWEEP_MS, STEADY_SWEEP_MS, STEADY_SWEEP_MS, STEADY_SWEEP_MS]);
  assert.equal(run.ended, 1);
});

test("it keeps re-checking after the first mute, and mutes a session that appears later", async () => {
  const run = await runWatch({
    rounds: 5,
    roots: () => [100],
    sessionsAt: (round) =>
      round < 2 ? [{ pid: 200, muted: true }] : round < 4 ? [{ pid: 200, muted: true }, { pid: 300, muted: true }] : [{ pid: 200, muted: true }],
  });
  assert.equal(run.shell.of("mute").length, 5, "every pass mutes again");
  assert.deepEqual(run.results.map((result) => result.sessions), [1, 1, 2, 2, 1]);
  assert.ok(run.results.every((result) => result.state === "muted"));
});

test("a helper failure is reported, retried at the steady pace, and recovers", async () => {
  let failing = true;
  const sleeps = [];
  const results = [];
  let round = 0;
  const muter = createAudioMuter({
    exec: async (file, args) => {
      if (failing && args.includes("mute")) return { code: 1, stdout: '{"error":"Class not registered"}', stderr: "" };
      return args.includes("processes") ? ok(TABLE) : ok({ sessions: [{ pid: 200, muted: true }] });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      round += 1;
      if (round === 2) failing = false;
    },
  });
  await muter.watch({ roots: () => (round >= 4 ? null : [100]), onResult: (result) => results.push(result) }).done;
  assert.deepEqual(results.map((result) => result.state), ["error", "error", "muted", "muted"]);
  assert.match(results[0].error, /Class not registered/);
  assert.deepEqual(sleeps, [STEADY_SWEEP_MS, STEADY_SWEEP_MS, STEADY_SWEEP_MS, STEADY_SWEEP_MS]);
});

test("it stops when the emulator is gone, and asks nothing of Windows with no pid to match", async () => {
  const run = await runWatch({ rounds: 3, roots: (round) => (round === 0 ? [] : [100]), sessionsAt: () => [{ pid: 200, muted: true }] });
  assert.deepEqual(run.results.map((result) => result.state), ["waiting", "muted", "muted"]);
  assert.equal(run.shell.of("mute").length, 2, "no sweep while there was no root");
  const gone = await runWatch({ rounds: 0, roots: () => [100], sessionsAt: () => [] });
  assert.equal(gone.results.length, 0);
  assert.equal(gone.shell.calls.length, 0);
  assert.equal(gone.ended, 1);
});

test("stop ends the loop, and nothing is reported after it", async () => {
  const results = [];
  const shell = fakeShell({ sessions: () => [{ pid: 200, muted: true }] });
  const muter = createAudioMuter({ exec: shell.exec, sleep: () => new Promise((done) => setImmediate(done)) });
  const watcher = muter.watch({ roots: () => [100], onResult: (result) => results.push(result) });
  while (results.length < 2) await new Promise((done) => setImmediate(done));
  await watcher.stop();
  const seen = results.length;
  const sweeps = shell.calls.length;
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setImmediate(done));
  assert.equal(results.length, seen);
  assert.equal(shell.calls.length, sweeps);
});

test("an onResult that throws does not end the watch", async () => {
  const logs = [];
  let round = 0;
  const muter = createAudioMuter({ exec: fakeShell({ sessions: () => [{ pid: 200, muted: true }] }).exec, sleep: async () => void (round += 1), log: (line) => logs.push(line) });
  await muter.watch({
    roots: () => (round >= 2 ? null : [100]),
    onResult: () => {
      throw new Error("sink");
    },
  }).done;
  assert.equal(round, 2);
  assert.deepEqual(logs, ["audio: sink", "audio: sink"]);
});

function deviceHarness(overrides = {}) {
  const logs = [];
  const launcher = Object.assign(new EventEmitter(), { pid: 100 });
  let alive = true;
  let round = 0;
  let sessions = [];
  const shell = fakeShell({ sessions: () => sessions });
  const muter = createAudioMuter({
    exec: shell.exec,
    sleep: async () => {
      round += 1;
      await new Promise((done) => setImmediate(done));
    },
  });
  const devices = createDevices({
    contract,
    paths: rigPaths(mkdtempSync(join(tmpdir(), "rig-host-"))),
    sdk: "sdk",
    spawn: () => launcher,
    exec: async () => ({ code: 0, stdout: "1\n", stderr: "" }),
    sleep: async () => {},
    isAlive: () => alive,
    discover: () => null,
    processInfo: async () => null,
    consoleToken: () => ({ path: "p", token: "t" }),
    sendConsole: async () => {
      alive = false;
      launcher.emit("exit", 0);
    },
    log: (line) => logs.push(line),
    audioMuter: muter,
    ...overrides,
  });
  return { devices, logs, launcher, shell, setSessions: (value) => (sessions = value), rounds: () => round };
}

const settleLoops = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((done) => setImmediate(done));
};

test("a device that boots has its emulator's audio session muted, and the status says so", async () => {
  const harness = deviceHarness();
  assert.equal(harness.devices.list().find((device) => device.name === "pixel").audio, null, "off devices report no audio");
  const booted = harness.devices.boot("pixel");
  harness.setSessions([{ pid: 200, muted: true, state: "active" }]);
  assert.equal((await booted).status, 200);
  await settleLoops();
  const pixel = harness.devices.list().find((device) => device.name === "pixel");
  assert.equal(pixel.state, "booted");
  assert.equal(pixel.audio.state, "muted");
  assert.deepEqual([pixel.audio.sessions, pixel.audio.muted], [1, 1]);
  assert.ok(harness.shell.of("mute").every((call) => call.pids.includes(100) && call.pids.includes(200)));
  assert.ok(harness.logs.some((line) => /^device pixel audio muted \(1\/1 sessions muted\)$/.test(line)));
  assert.deepEqual(harness.devices.list().filter((device) => device.name !== "pixel").map((device) => device.audio), [null, null, null]);
  await harness.devices.close();
});

test("a killed device stops being watched, and a booted one is never reported silent without a read-back", async () => {
  const harness = deviceHarness();
  harness.setSessions([{ pid: 200, muted: false }]);
  await harness.devices.boot("pixel");
  await settleLoops();
  const pixel = () => harness.devices.list().find((device) => device.name === "pixel");
  assert.equal(pixel().audio.state, "unmuted");
  assert.equal(audioSilenced(harness.devices.list()), false);
  assert.equal((await harness.devices.kill("pixel")).status, 200);
  await settleLoops();
  const mutesAfter = harness.shell.of("mute").length;
  await settleLoops();
  assert.equal(harness.shell.of("mute").length, mutesAfter, "no sweeps once the device is off");
  assert.equal(pixel().audio, null);
  assert.equal(audioSilenced(harness.devices.list()), true);
});

test("without a muter the devices are left as they were", async () => {
  const harness = deviceHarness({ audioMuter: null });
  await harness.devices.boot("pixel");
  assert.equal(harness.devices.list().find((device) => device.name === "pixel").audio, null);
  assert.equal(harness.shell.calls.length, 0);
  await harness.devices.close();
});

test("health reports whether any running emulator can be heard", () => {
  const devices = (audio) => [{ name: "pixel", state: "booted", audio }, { name: "emulator-34", state: "off", audio: null }];
  assert.equal(audioSilenced(devices({ state: "muted" })), true);
  assert.equal(audioSilenced(devices({ state: "waiting" })), true, "no session yet: nothing to hear");
  assert.equal(audioSilenced(devices({ state: "unmuted" })), false);
  assert.equal(audioSilenced(devices({ state: "error" })), false);
  assert.equal(audioSilenced(devices(null)), false, "running and never read");
  assert.equal(audioSilenced([]), true);
  const report = healthReport({ facts: { whpx: { usable: true, detail: "" }, host: null }, adbUp: true, tunnel: { up: true, since: null }, devices: devices({ state: "muted" }) });
  assert.equal(report.audio_silenced, true);
  assert.equal(report.devices[0].audio.state, "muted");
});

test("the helper script mutes sessions and nothing else on the machine", () => {
  const script = readFileSync(AUDIO_SCRIPT, "utf8");
  assert.match(script, /\.SetMute\(true, ref context\)/);
  assert.match(script, /\$Action -eq 'mute'/, "only the mute action mutes");
  for (const forbidden of [/\.SetMasterVolume\(/, /GetDefaultAudioEndpoint/, /SetDefaultEndpoint/, /Set-ItemProperty/, /New-ItemProperty/, /\breg(\.exe)?\s+add/i, /Set-ExecutionPolicy/]) {
    assert.doesNotMatch(script, forbidden);
  }
});

/** A stand-in for the long-running powershell.exe: it records what hostd writes and answers on demand. */
function fakeServe() {
  const procs = [];
  const spawn = (file, args, options) => {
    const proc = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), killed: false, file, args, options, written: [] });
    proc.stdin.on("data", (chunk) => proc.written.push(...String(chunk).split("\n").filter(Boolean)));
    proc.kill = () => {
      proc.killed = true;
      proc.emit("exit", null);
    };
    procs.push(proc);
    return proc;
  };
  const tick = () => new Promise((done) => setImmediate(done));
  return { spawn, procs, tick, say: async (proc, line) => (proc.stdout.write(`${line}\r\n`), tick()) };
}

test("the persistent helper starts on the first call and speaks one command per line", async () => {
  const serve = fakeServe();
  const helper = persistentHelper({ spawn: serve.spawn });
  assert.equal(serve.procs.length, 0, "nothing runs until it is needed");
  const first = helper.call("processes");
  await serve.tick();
  const [proc] = serve.procs;
  assert.equal(proc.file, "powershell.exe");
  assert.deepEqual(proc.args.slice(-4), ["-File", AUDIO_SCRIPT, "-Action", "serve"]);
  assert.deepEqual(proc.written, ["processes"]);
  await serve.say(proc, JSON.stringify(TABLE));
  assert.deepEqual(await first, TABLE);
  const mute = helper.call("mute", { key: "pixel", pids: [100, 200] });
  await serve.tick();
  assert.equal(proc.written.at(-1), "mute pixel 100,200");
  await serve.say(proc, '{"sessions":[]}');
  assert.deepEqual(await mute, { sessions: [] });
  const status = helper.call("status", { pids: [300] });
  await serve.tick();
  assert.equal(proc.written.at(-1), "status 300");
  await serve.say(proc, '{"sessions":[]}');
  await status;
  assert.equal(serve.procs.length, 1, "one process serves every call");
  assert.throws(() => helper.call("mute", { pids: [1] }), /owner key/);
  assert.throws(() => helper.call("mute", { key: "a b", pids: [1] }), /owner key/);
});

test("calls are answered in order, one at a time", async () => {
  const serve = fakeServe();
  const helper = persistentHelper({ spawn: serve.spawn });
  const one = helper.call("status", { pids: [1] });
  const two = helper.call("status", { pids: [2] });
  await serve.tick();
  const [proc] = serve.procs;
  assert.deepEqual(proc.written, ["status 1"], "the second waits for the first's answer");
  await serve.say(proc, '{"sessions":[{"pid":1}]}');
  await serve.tick();
  assert.deepEqual(proc.written, ["status 1", "status 2"]);
  await serve.say(proc, '{"sessions":[{"pid":2}]}');
  assert.deepEqual((await one).sessions, [{ pid: 1 }]);
  assert.deepEqual((await two).sessions, [{ pid: 2 }]);
});

test("a session muted on creation is logged and never taken for an answer", async () => {
  const serve = fakeServe();
  const logs = [];
  const helper = persistentHelper({ spawn: serve.spawn, log: (line) => logs.push(line) });
  const call = helper.call("status", { pids: [200] });
  await serve.tick();
  const [proc] = serve.procs;
  await serve.say(proc, "event muted 200");
  await serve.say(proc, '{"sessions":[]}');
  assert.deepEqual(await call, { sessions: [] });
  assert.deepEqual(logs, ["audio: muted 200"]);
});

test("a helper that errors, dies or stalls fails that call and is started again for the next", async () => {
  const serve = fakeServe();
  const helper = persistentHelper({ spawn: serve.spawn, timeoutMs: 30 });
  const failed = helper.call("status", { pids: [1] });
  await serve.tick();
  await serve.say(serve.procs[0], '{"error":"Class not registered"}');
  await assert.rejects(failed, /Class not registered/);
  assert.equal(serve.procs.length, 1, "an error answer leaves the process running");

  const died = helper.call("status", { pids: [1] });
  await serve.tick();
  serve.procs[0].emit("exit", 1);
  await assert.rejects(died, /exited \(1\)/);

  const stalled = helper.call("status", { pids: [1] });
  await serve.tick();
  assert.equal(serve.procs.length, 2, "started again");
  await assert.rejects(stalled, /no answer/);
  assert.equal(serve.procs[1].killed, true, "a helper that stops answering is killed");

  const recovered = helper.call("status", { pids: [1] });
  await serve.tick();
  assert.equal(serve.procs.length, 3);
  await serve.say(serve.procs[2], '{"sessions":[]}');
  assert.deepEqual(await recovered, { sessions: [] });
});

test("release clears an owner's standing order, and close ends the helper's input", async () => {
  const serve = fakeServe();
  const helper = persistentHelper({ spawn: serve.spawn });
  await helper.release("pixel");
  assert.equal(serve.procs.length, 0, "nothing to clear while no helper runs");
  const call = helper.call("mute", { key: "pixel", pids: [200] });
  await serve.tick();
  const [proc] = serve.procs;
  await serve.say(proc, '{"sessions":[]}');
  await call;
  const release = helper.release("pixel");
  await serve.tick();
  assert.equal(proc.written.at(-1), "clear pixel");
  await serve.say(proc, '{"cleared":true}');
  await release;
  let ended = false;
  proc.stdin.on("end", () => (ended = true));
  await helper.close();
  await serve.tick();
  assert.equal(ended, true);
});

test("each device is its own owner, and its order is cleared when its watch ends", async () => {
  const calls = [];
  const helper = {
    call: async (action, args) => {
      calls.push([action, args?.key, args?.pids]);
      return action === "processes" ? TABLE : { sessions: [{ pid: 200, muted: true }] };
    },
    release: async (key) => void calls.push(["release", key]),
    close: async () => {},
  };
  let round = 0;
  const muter = createAudioMuter({ helper, sleep: async () => void (round += 1) });
  await muter.watch({ key: "pixel", roots: () => (round >= 2 ? null : [100]) }).done;
  assert.deepEqual(calls.filter(([action]) => action === "mute").map(([, key, pids]) => [key, pids]), [["pixel", [100, 200, 300]], ["pixel", [100, 200, 300]]]);
  assert.deepEqual(calls.at(-1), ["release", "pixel"]);
});

test("a helper line is JSON or an error", () => {
  assert.deepEqual(parseHelperLine('{"cleared":true}'), { cleared: true });
  assert.throws(() => parseHelperLine("event muted 1"), /no JSON/);
  assert.throws(() => parseHelperLine('{"error":"x"}'), /audio helper: x/);
});
