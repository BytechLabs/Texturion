import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { adbEnv, bootCompletedArgs, devicesArgs, parseDevices, startServerArgs } from "../src/adb.mjs";
import { deviceByName, loadContract, rigPaths } from "../src/config.mjs";
import {
  AUDIO_FLAG,
  createDevices,
  emulatorArgs,
  emulatorBinary,
  emulatorEnv,
  findDiscovery,
  parseIni,
  readConsoleToken,
} from "../src/emulator.mjs";

const contract = loadContract();
const pixel = deviceByName(contract, "pixel");
const api35 = deviceByName(contract, "emulator-35");
const DNS = contract.vm.address;

test("the emulator runs headless, accelerated, with token-guarded gRPC and the VM as its DNS", () => {
  assert.deepEqual(emulatorArgs(pixel, { dnsServer: DNS }), [
    "-avd", "rig-pixel", "-port", "5560", "-grpc", "8560", "-grpc-use-token",
    "-no-window", "-no-boot-anim", "-no-snapshot-save", "-gpu", "swiftshader_indirect",
    "-accel", "on", "-dns-server", "192.168.70.10",
  ]);
  assert.deepEqual(emulatorArgs(api35, { dnsServer: DNS, cold: true }).slice(-1), ["-no-snapshot-load"]);
  assert.deepEqual(emulatorArgs(api35, { dnsServer: DNS, wipe: true }).slice(-2), ["-no-snapshot-load", "-wipe-data"]);
});

test("the host's microphone is never wired in, and the audio flag waits on EA1", () => {
  assert.equal(AUDIO_FLAG, null);
  for (const options of [{}, { cold: true }, { wipe: true }, { audio: "-no-audio" }]) {
    assert.ok(!emulatorArgs(pixel, { dnsServer: DNS, ...options }).includes("-allow-host-audio"));
  }
  assert.throws(() => emulatorArgs(pixel, { dnsServer: DNS, audio: "-allow-host-audio" }), /not an allowed audio flag/);
  assert.ok(emulatorArgs(pixel, { dnsServer: DNS, audio: "-no-audio" }).includes("-no-audio"));
});

test("a bad AVD name, console port or DNS server is refused", () => {
  assert.throws(() => emulatorArgs({ ...pixel, avd: "rig pixel; x" }, { dnsServer: DNS }), /AVD name/);
  assert.throws(() => emulatorArgs({ ...pixel, console: 5561 }, { dnsServer: DNS }), /even/);
  assert.throws(() => emulatorArgs({ ...pixel, console: 5700 }, { dnsServer: DNS }), /even/);
  assert.throws(() => emulatorArgs(pixel, {}), /DNS server/);
});

test("the emulator's environment is the rig's own SDK, homes and adb server", () => {
  const paths = rigPaths(join("F:", "loonext-rig"));
  const env = emulatorEnv({
    paths,
    sdk: "D:\\Android\\sdk",
    adbPort: 5137,
    base: { PATH: "p", ANDROID_HOME: "C:\\agents-sdk", ANDROID_SDK_HOME: "x", ANDROID_ADB_SERVER_ADDRESS: "0.0.0.0", ANDROID_SERIAL: "s" },
  });
  assert.equal(env.ANDROID_SDK_ROOT, "D:\\Android\\sdk");
  assert.equal(env.ANDROID_AVD_HOME, paths.avd);
  assert.equal(env.ANDROID_EMULATOR_HOME, paths.emulatorHome);
  assert.equal(env.ANDROID_ADB_SERVER_PORT, "5137");
  assert.equal(env.PATH, "p");
  for (const name of ["ANDROID_HOME", "ANDROID_SDK_HOME", "ANDROID_ADB_SERVER_ADDRESS", "ANDROID_SERIAL"]) assert.equal(env[name], undefined, name);
  assert.equal(emulatorBinary("D:\\Android\\sdk"), join("D:\\Android\\sdk", "emulator", "emulator.exe"));
});

test("adb talks to the rig's 5137 server and never to the agents' 5037", () => {
  assert.deepEqual(startServerArgs(5137), ["-P", "5137", "start-server"]);
  assert.deepEqual(devicesArgs(5137), ["-P", "5137", "devices"]);
  assert.deepEqual(bootCompletedArgs(5137, "emulator-5560"), ["-P", "5137", "-s", "emulator-5560", "shell", "getprop", "sys.boot_completed"]);
  assert.ok(!startServerArgs(5137).includes("-a"), "listens on loopback");
  assert.throws(() => startServerArgs(5037), /not the rig's adb server port/);
  assert.throws(() => bootCompletedArgs(5137, "R5CT1234"), /emulator serial/);
  assert.equal(adbEnv(5137, { ANDROID_ADB_SERVER_ADDRESS: "0.0.0.0" }).ANDROID_ADB_SERVER_ADDRESS, undefined);
  assert.deepEqual(parseDevices("List of devices attached\nemulator-5560\tdevice\nemulator-5554\toffline\n\n"), ["emulator-5560"]);
});

function discoveryDir() {
  const dir = mkdtempSync(join(tmpdir(), "avd-running-"));
  writeFileSync(join(dir, "pid_4100.ini"), "port.serial=5554\r\ngrpc.port=8554\r\ngrpc.token=other-token\r\navd.name=rig-api34\r\n");
  writeFileSync(join(dir, "pid_4200.ini"), "port.serial=5560\r\ngrpc.port=8560\r\ngrpc.token=pixel-token\r\navd.name=rig-pixel\r\n");
  writeFileSync(join(dir, "pid_4300.ini"), "port.serial=5999\r\ngrpc.port=8560\r\ngrpc.token=impostor\r\n");
  writeFileSync(join(dir, "notes.ini"), "grpc.port=8560\r\n");
  return dir;
}

test("the gRPC token and the emulator's own pid come from its discovery file", () => {
  assert.deepEqual(parseIni("a=1\r\n# c=2\r\n b = x=y \r\n"), { a: "1", b: "x=y" });
  const dir = discoveryDir();
  assert.deepEqual(findDiscovery(pixel, [join(dir, "absent"), dir]), { path: join(dir, "pid_4200.ini"), pid: 4200, grpcToken: "pixel-token" });
  assert.equal(findDiscovery(api35, [dir]), null);
});

test("the console token is read from the rig's emulator home first", () => {
  const root = mkdtempSync(join(tmpdir(), "rig-host-"));
  const paths = rigPaths(root);
  const profile = mkdtempSync(join(tmpdir(), "profile-"));
  writeFileSync(join(profile, ".emulator_console_auth_token"), "user-token\n");
  assert.deepEqual(readConsoleToken(paths, { USERPROFILE: profile }), { path: join(profile, ".emulator_console_auth_token"), token: "user-token" });
  mkdirSync(paths.emulatorHome, { recursive: true });
  writeFileSync(join(paths.emulatorHome, ".emulator_console_auth_token"), "rig-token");
  assert.equal(readConsoleToken(paths, { USERPROFILE: profile }).token, "rig-token");
  assert.equal(readConsoleToken(rigPaths(join(root, "none")), {}), null);
});

/** createDevices with every side effect faked. */
function fakeDevices({ bootAfter = 2, alive = new Set(), discover = () => null } = {}) {
  let clock = 0;
  const spawned = [];
  const killed = [];
  const polls = new Map();
  const devices = createDevices({
    contract,
    paths: rigPaths(mkdtempSync(join(tmpdir(), "rig-host-"))),
    sdk: "sdk",
    spawn: (file, args, options) => {
      const child = Object.assign(new EventEmitter(), { pid: 9000 + spawned.length });
      alive.add(child.pid);
      spawned.push({ file, args, options, child });
      return child;
    },
    exec: async (_file, args) => {
      const serial = args[args.indexOf("-s") + 1];
      const count = (polls.get(serial) ?? 0) + 1;
      polls.set(serial, count);
      return { code: 0, stdout: count >= bootAfter ? "1\n" : "\n", stderr: "" };
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    isAlive: (pid) => alive.has(pid),
    killPid: (pid) => {
      killed.push(pid);
      alive.delete(pid);
    },
    discover,
    consoleToken: () => ({ path: "p", token: "console-secret" }),
    sendConsole: async () => {},
  });
  return { devices, spawned, killed, alive };
}

test("a boot answers once sys.boot_completed is 1, through the rig's adb server", async () => {
  const { devices, spawned } = fakeDevices({ bootAfter: 3 });
  assert.deepEqual(await devices.boot("pixel"), { status: 200, body: { state: "booted" } });
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args, emulatorArgs(pixel, { dnsServer: DNS }));
  assert.equal(spawned[0].options.env.ANDROID_ADB_SERVER_PORT, "5137");
  assert.deepEqual(devices.list().find((device) => device.name === "pixel"), { name: "pixel", serial: "emulator-5560", state: "booted", pid: 9000 });
  assert.deepEqual(await devices.boot("pixel"), { status: 200, body: { state: "booted" } }, "booting a booted device is a no-op");
  assert.equal(spawned.length, 1);
  assert.equal((await devices.boot("pixel", { wipe: true })).status, 409, "a wipe needs the device off");
});

test("a boot that never completes answers 504 after five minutes", async () => {
  const { devices } = fakeDevices({ bootAfter: Number.POSITIVE_INFINITY });
  assert.deepEqual(await devices.boot("emulator-34"), { status: 504, body: { error: "boot.timeout" } });
});

test("max_booted devices at once, and a 409 past it", async () => {
  const { devices } = fakeDevices();
  for (const name of ["pixel", "emulator-34", "emulator-35"]) assert.equal((await devices.boot(name)).status, 200);
  assert.deepEqual(await devices.boot("emulator-36"), { status: 409, body: { error: "max_booted", max_booted: 3 } });
  assert.equal((await devices.boot("nope")).status, 404);
});

test("a hard kill terminates the emulator's own pid and the launcher's; a soft one uses the console", async () => {
  const alive = new Set([7000]);
  const { devices, killed } = fakeDevices({ alive, discover: (device) => (device.name === "pixel" ? { pid: 7000, grpcToken: "g" } : null) });
  await devices.boot("pixel");
  assert.deepEqual(await devices.kill("pixel", { hard: true }), { status: 200, body: { state: "off" } });
  assert.deepEqual(killed.sort(), [7000, 9000]);
  assert.equal(devices.list().find((device) => device.name === "pixel").state, "off");
  assert.deepEqual(await devices.kill("pixel"), { status: 200, body: { state: "off" } }, "killing an off device is a no-op");
});

test("an emulator a previous hostd started is adopted, and a boot waits for it instead of starting another", async () => {
  const alive = new Set([7100]);
  const { devices, spawned } = fakeDevices({ alive, discover: (device) => (device.name === "pixel" ? { pid: 7100, grpcToken: "g" } : null) });
  await devices.adopt();
  assert.equal(devices.list().find((device) => device.name === "pixel").state, "booting");
  assert.deepEqual(await devices.boot("pixel"), { status: 200, body: { state: "booted" } });
  assert.equal(spawned.length, 0);
  assert.equal(devices.list().find((device) => device.name === "pixel").pid, 7100);
  alive.delete(7100);
  assert.equal(devices.list().find((device) => device.name === "pixel").state, "off", "an adopted emulator that died is off");
});

test("emulators are started outside hostd's job, so a hostd restart leaves them running", async () => {
  const { devices, spawned } = fakeDevices();
  await devices.boot("emulator-36");
  assert.equal(spawned[0].options.detached, true);
});

test("tokens exist only for a running device", async () => {
  const { devices } = fakeDevices({ discover: () => ({ pid: 1, grpcToken: "grpc-secret" }) });
  assert.equal(devices.tokens("pixel").status, 409);
  await devices.boot("pixel");
  assert.deepEqual(devices.tokens("pixel"), { status: 200, body: { console_token: "console-secret", grpc_token: "grpc-secret" } });
  assert.equal(devices.tokens("nope").status, 404);
});
