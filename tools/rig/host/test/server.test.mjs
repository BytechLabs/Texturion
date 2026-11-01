import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { loadContract, rigPaths } from "../src/config.mjs";
import { createDevices } from "../src/emulator.mjs";
import { parseAcSleepMinutes, parseAccelCheck, parseRegDword } from "../src/host-facts.mjs";
import { BIND, bearerMatches, createHostdServer, listen, parseFlags } from "../src/server.mjs";
import { startupPath, startupScript } from "../src/startup.mjs";

const contract = loadContract();
const TOKEN = "hostd-test-token-0123456789abcdef0123456789abcdef";
const CONSOLE_TOKEN = "console-token-value-not-for-logs";
const GRPC_TOKEN = "grpc-token-value-not-for-logs";
const logs = [];
let server;
let origin;

function devices() {
  let clock = 0;
  return createDevices({
    contract,
    paths: rigPaths(mkdtempSync(join(tmpdir(), "rig-host-"))),
    sdk: "sdk",
    spawn: () => Object.assign(new EventEmitter(), { pid: 4242 }),
    exec: async () => ({ code: 0, stdout: "1\n", stderr: "" }),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    isAlive: () => true,
    discover: () => ({ pid: 4242, grpcToken: GRPC_TOKEN }),
    consoleToken: () => ({ path: "p", token: CONSOLE_TOKEN }),
    log: (line) => logs.push(line),
  });
}

const call = (path, { method = "GET", token = TOKEN, body } = {}) =>
  fetch(`${origin}${path}`, {
    method,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));

before(async () => {
  const health = async () => ({ ok: true, whpx: { usable: true, detail: "" }, adb: { listening: true }, tunnel: { up: true, since: null }, reboot_pending: false, devices: [], host: null });
  server = createHostdServer({ token: TOKEN, devices: devices(), health, log: (line) => logs.push(line) });
  const address = await listen(server, 0);
  origin = `http://127.0.0.1:${address.port}`;
});

after(() => server.close());

test("it binds 127.0.0.1 and nothing wider", () => {
  assert.equal(BIND, "127.0.0.1");
  assert.equal(server.address().address, "127.0.0.1");
});

test("every request without the right bearer token is 401, whatever the path", async () => {
  for (const path of ["/v1/health", "/v1/devices/pixel/tokens", "/nope"]) {
    assert.equal((await call(path, { token: null })).status, 401, path);
    assert.equal((await call(path, { token: "wrong" })).status, 401, path);
  }
  assert.equal(bearerMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(bearerMatches(`bearer ${TOKEN}`, TOKEN), false);
  assert.equal(bearerMatches(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(bearerMatches(undefined, TOKEN), false);
  assert.equal(bearerMatches(`Bearer ${TOKEN}`, ""), false);
});

test("health answers with the token", async () => {
  const { status, body } = await call("/v1/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test("a name outside the contract, any other path and a wrong method are 404; there is no VM route", async () => {
  assert.equal((await call("/v1/devices/emulator-37/boot", { method: "POST" })).status, 404);
  assert.equal((await call("/v1/devices/%E0%A4%A/boot", { method: "POST" })).status, 404);
  assert.equal((await call("/v1/devices/pixel/boot")).status, 404, "GET on a POST route");
  assert.equal((await call("/v1/devices/pixel/tokens", { method: "POST" })).status, 404);
  for (const path of ["/", "/v1", "/v1/vm/start", "/v1/vm/revert", "/v1/devices", "/v1/devices/pixel"]) {
    assert.equal((await call(path, { method: "POST" })).status, 404, path);
  }
});

test("boot, 409 at max_booted, tokens and kill", async () => {
  assert.equal((await call("/v1/devices/pixel/tokens")).status, 409, "no tokens while off");
  assert.deepEqual(await call("/v1/devices/pixel/boot", { method: "POST", body: {} }), { status: 200, body: { state: "booted" } });
  assert.equal((await call("/v1/devices/emulator-34/boot", { method: "POST", body: { cold: true } })).status, 200);
  assert.equal((await call("/v1/devices/emulator-35/boot", { method: "POST" })).status, 200);
  assert.deepEqual(await call("/v1/devices/emulator-36/boot", { method: "POST" }), {
    status: 409,
    body: { error: "max_booted", max_booted: 3 },
  });
  assert.deepEqual(await call("/v1/devices/pixel/tokens"), { status: 200, body: { console_token: CONSOLE_TOKEN, grpc_token: GRPC_TOKEN } });
  assert.equal((await call("/v1/devices/pixel/boot", { method: "POST", body: { cold: "yes" } })).status, 400);
  assert.equal((await call("/v1/devices/pixel/kill", { method: "POST", body: { hard: true, now: true } })).status, 400);
  assert.equal((await call("/v1/devices/pixel/kill", { method: "POST", body: "{" })).status, 400);
  assert.equal((await call("/v1/devices/pixel/kill", { method: "POST", body: "x".repeat(5000) })).status, 413);
});

test("no token, presented or served, reaches the log", async () => {
  await call("/v1/devices/pixel/tokens", { token: "a-guessed-token-value" });
  await call("/v1/devices/pixel/tokens");
  const text = logs.join("\n");
  assert.ok(logs.some((line) => /^GET \/v1\/devices\/pixel\/tokens 200$/.test(line)), "requests are logged");
  for (const secret of [TOKEN, CONSOLE_TOKEN, GRPC_TOKEN, "a-guessed-token-value"]) assert.ok(!text.includes(secret), secret);
});

test("flags are optional booleans with known keys only", () => {
  const keys = new Set(["cold", "wipe"]);
  assert.deepEqual(parseFlags("", keys), {});
  assert.deepEqual(parseFlags('{"cold":true}', keys), { cold: true });
  assert.equal(parseFlags('{"cold":1}', keys), null);
  assert.equal(parseFlags('{"vm":true}', keys), null);
  assert.equal(parseFlags("[]", keys), null);
});

test("host facts are parsed from the tools' own output", () => {
  assert.deepEqual(parseAccelCheck({ code: 0, stdout: "accel:\n0\nWHPX(10.0.26300) is installed and usable.\naccel\n" }), {
    usable: true,
    detail: "WHPX(10.0.26300) is installed and usable.",
  });
  assert.equal(parseAccelCheck({ code: 1, stdout: "accel:\n1\nWHPX is not installed or is not enabled\naccel\n" }).usable, false);
  assert.equal(parseAccelCheck({ code: 0, stdout: "AEHD is installed and usable." }).usable, false);
  const reg = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings\r\n    ActiveHoursStart    REG_DWORD    0x8\r\n    ActiveHoursEnd    REG_DWORD    0x2\r\n";
  assert.equal(parseRegDword(reg, "ActiveHoursStart"), 8);
  assert.equal(parseRegDword(reg, "ActiveHoursEnd"), 2);
  assert.equal(parseRegDword(reg, "Missing"), null);
  assert.equal(parseAcSleepMinutes("    Current AC Power Setting Index: 0x00000000\r\n    Current DC Power Setting Index: 0x00000384"), 0);
  assert.equal(parseAcSleepMinutes("    Current AC Power Setting Index: 0x00000708"), 30);
  assert.equal(parseAcSleepMinutes(""), null);
});

test("the Startup entry is per user, fixes the root and refuses characters cmd.exe would read", () => {
  assert.equal(
    startupPath({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }),
    join("C:\\Users\\x\\AppData\\Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "loonext-rig-hostd.cmd"),
  );
  assert.throws(() => startupPath({}), /APPDATA/);
  const script = startupScript({ node: "C:\\node\\node.exe", hostd: "D:\\r\\tools\\rig\\host\\hostd.mjs", root: "F:\\loonext-rig" });
  assert.match(script, /^@echo off\r\n/);
  assert.match(script, /\r\nset "RIG_HOST_ROOT=F:\\loonext-rig"\r\n/);
  assert.match(script, /start "loonext-rig-hostd" \/min "C:\\node\\node\.exe" "D:\\r\\tools\\rig\\host\\hostd\.mjs" serve\r\n$/);
  assert.throws(() => startupScript({ node: "n", hostd: "h", root: "F:\\a&calc" }), /cmd\.exe/);
});
