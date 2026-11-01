#!/usr/bin/env node
// hostd: the rig's supervisor on the Windows workstation (docs/RIG.md, D142).
//
//   node tools/rig/host/hostd.mjs serve
//   node tools/rig/host/hostd.mjs vm status|start|stop|revert <snapshot>
//   node tools/rig/host/hostd.mjs devices list|boot <name> [--cold] [--wipe]|kill <name> [--hard]
//   node tools/rig/host/hostd.mjs doctor
//   node tools/rig/host/hostd.mjs install-startup --yes
//
// Plain Node 22 with no dependencies. State lives under RIG_HOST_ROOT
// (default F:\loonext-rig); the VM's lanes reach `serve` through the tunnel.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { adbBinary, adbEnv, devicesArgs, foreignSerials, isListening, parseDevices, startServerArgs } from "./src/adb.mjs";
import { loadContract, loadHostConfig, serialOf } from "./src/config.mjs";
import { consoleTokenPaths, createDevices, discoveryDirs, emulatorBinary, findDiscovery } from "./src/emulator.mjs";
import { healthReport, readHostFacts } from "./src/host-facts.mjs";
import { createHostdServer, listen } from "./src/server.mjs";
import { installStartup } from "./src/startup.mjs";
import { createTunnel } from "./src/tunnel.mjs";
import { MARKER, vmControls } from "./src/vmrun.mjs";

const FACTS_EVERY_MS = 5 * 60 * 1000;

/** Runs a program to completion; never throws on a non-zero exit. */
function run(file, args, { env, input, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, windowsHide: true, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

function logger(paths) {
  mkdirSync(paths.logs, { recursive: true });
  const file = join(paths.logs, "hostd.log");
  return (line) => {
    const entry = `${new Date().toISOString()} ${line}`;
    console.log(entry);
    try {
      appendFileSync(file, `${entry}\n`);
    } catch {
      // the console line stands
    }
  };
}

function ensureToken(paths) {
  mkdirSync(paths.host, { recursive: true });
  if (!existsSync(paths.token)) writeFileSync(paths.token, randomBytes(32).toString("hex"), { flag: "wx" });
  const token = readFileSync(paths.token, "utf8").trim();
  if (token.length < 32) throw new Error(`hostd: ${paths.token} holds no usable token`);
  return token;
}

function flagsOf(argv) {
  return { positional: argv.filter((arg) => !arg.startsWith("--")), flags: new Set(argv.filter((arg) => arg.startsWith("--"))) };
}

async function serve({ contract, root, sdk, paths }) {
  const log = logger(paths);
  const token = ensureToken(paths);
  const vm = vmControls({ vmx: paths.vmx, root, exec: run });

  try {
    const status = await vm.status();
    if (status.state === "off") {
      log("vm: starting");
      await vm.start();
    } else {
      log(`vm: ${status.state}`);
    }
  } catch (cause) {
    log(`vm: ${cause.message}`);
  }

  const adbPort = contract.adb.server_port;
  const started = await run(adbBinary(sdk), startServerArgs(adbPort), { env: adbEnv(adbPort) }).catch((cause) => ({ code: -1, stderr: cause.message }));
  log(`adb: start-server on ${adbPort} (${started.code})`);

  const devices = createDevices({ contract, paths, sdk, spawn, exec: run, log });
  await devices.adopt();

  const tunnel = createTunnel({ contract, paths, spawn, run, log });
  tunnel.start();

  let facts = { whpx: { usable: false, detail: "not read yet" }, host: null };
  const refresh = async () => {
    facts = await readHostFacts({ exec: run, sdk, root }).catch((cause) => ({ whpx: { usable: false, detail: cause.message }, host: null }));
  };
  await refresh();
  const timer = setInterval(refresh, FACTS_EVERY_MS);

  const health = async () => healthReport({ facts, adbUp: await isListening(adbPort), tunnel: tunnel.state, devices: devices.list() });

  const server = createHostdServer({ token, devices, health, log });
  const address = await listen(server, contract.hostd.port);
  log(`hostd: serving on ${address.address}:${address.port}`);

  for (const device of contract.devices.filter((entry) => entry.warm)) {
    devices.boot(device.name).then((result) => log(`device ${device.name} warm boot: ${result.status}`));
  }

  const stop = () => {
    log("hostd: stopping; emulators keep running and are adopted on the next start");
    clearInterval(timer);
    tunnel.stop();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function vmCommand({ root, paths }, [action, snapshot]) {
  const vm = vmControls({ vmx: paths.vmx, root, exec: run });
  if (action === "status") return console.log(JSON.stringify(await vm.status()));
  if (action === "start") return void (await vm.start());
  if (action === "stop") return void (await vm.stop());
  if (action === "revert") {
    if (!snapshot) throw new Error("hostd vm revert <snapshot>");
    await vm.revert(snapshot);
    await vm.start();
    return;
  }
  throw new Error("hostd vm status|start|stop|revert <snapshot>");
}

async function callHostd({ contract, paths }, method, path, body) {
  const token = readFileSync(paths.token, "utf8").trim();
  const response = await fetch(`http://127.0.0.1:${contract.hostd.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function devicesCommand(context, argv) {
  const { positional, flags } = flagsOf(argv);
  const [action, name] = positional;
  if (action === "list") {
    const { body } = await callHostd(context, "GET", "/v1/health");
    for (const device of body.devices ?? []) console.log(`${device.name}\t${device.serial}\t${device.state}\t${device.pid ?? ""}`);
    return;
  }
  if ((action === "boot" || action === "kill") && name) {
    const body = action === "boot" ? { cold: flags.has("--cold"), wipe: flags.has("--wipe") } : { hard: flags.has("--hard") };
    const result = await callHostd(context, "POST", `/v1/devices/${encodeURIComponent(name)}/${action}`, body);
    console.log(`${result.status} ${JSON.stringify(result.body)}`);
    if (result.status !== 200) process.exitCode = 1;
    return;
  }
  throw new Error("hostd devices list|boot <name> [--cold] [--wipe]|kill <name> [--hard]");
}

/** Read-only: what is in place, what answers, and where the emulator put its files. */
async function doctor({ contract, root, sdk, paths }) {
  const lines = [];
  const check = (ok, what) => lines.push(`${ok ? "ok  " : "FAIL"} ${what}`);
  const note = (what) => lines.push(`     ${what}`);

  check(existsSync(paths.vmx) && MARKER.test(readFileSync(paths.vmx, "utf8")), `${paths.vmx} exists with its marker`);
  check(existsSync(paths.sshKey), `${paths.sshKey} (the client key)`);
  check(existsSync(paths.knownHosts), `${paths.knownHosts} (the VM's pinned host key)`);
  check(existsSync(paths.token), `${paths.token}`);
  check(existsSync(emulatorBinary(sdk)), emulatorBinary(sdk));
  check(existsSync(adbBinary(sdk)), adbBinary(sdk));
  for (const device of contract.devices) check(existsSync(join(paths.avd, `${device.avd}.ini`)), `AVD ${device.avd} in ${paths.avd}`);

  const vm = vmControls({ vmx: paths.vmx, root, exec: run });
  const status = await vm.status().catch((cause) => ({ state: "unknown", detail: cause.message }));
  check(status.state === "running", `vm ${status.state}${status.address ? ` at ${status.address}` : ""}${status.detail ? `: ${status.detail}` : ""}`);

  const facts = await readHostFacts({ exec: run, sdk, root });
  check(facts.whpx.usable, `WHPX: ${facts.whpx.detail}`);
  check(!facts.host.pending_reboot, "no reboot pending");
  note(`active hours ${JSON.stringify(facts.host.active_hours)}, AC sleep ${facts.host.ac_sleep_minutes} min, ${facts.host.f_free_gb} GB free`);
  note(`session: ${process.env.SESSIONNAME ?? "none (no interactive session)"}`);

  const adbPort = contract.adb.server_port;
  const adbUp = await isListening(adbPort);
  check(adbUp, `adb server on 127.0.0.1:${adbPort}`);
  check(await isListening(contract.hostd.port), `hostd on 127.0.0.1:${contract.hostd.port}`);
  if (adbUp) {
    const { stdout } = await run(adbBinary(sdk), devicesArgs(adbPort), { env: adbEnv(adbPort) });
    note(`adb -P ${adbPort} devices: ${parseDevices(stdout).join(", ") || "none"} (VM3: emulators register with the rig's server)`);
    const foreign = foreignSerials(stdout, contract.devices.map(serialOf));
    check(foreign.length === 0, `adb -P ${adbPort} lists no device outside the contract${foreign.length ? `: ${foreign.length} found` : ""}`);
  }

  for (const path of consoleTokenPaths(paths)) note(`console token ${existsSync(path) ? "found" : "absent"} at ${path}`);
  for (const dir of discoveryDirs(paths)) note(`discovery dir ${existsSync(dir) ? "exists" : "absent"}: ${dir}`);
  for (const device of contract.devices) {
    const found = findDiscovery(device, discoveryDirs(paths));
    if (found) note(`${device.name} (${serialOf(device)}) advertises in ${found.path}, pid ${found.pid}, gRPC token ${found.grpcToken ? "present" : "absent"}`);
  }
  console.log(lines.join("\n"));
  if (lines.some((line) => line.startsWith("FAIL"))) process.exitCode = 1;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const contract = loadContract();
  const { root, sdk, paths } = loadHostConfig();
  const context = { contract, root, sdk, paths };
  if (command === "serve") return serve(context);
  if (command === "vm") return vmCommand(context, rest);
  if (command === "devices") return devicesCommand(context, rest);
  if (command === "doctor") return doctor(context);
  if (command === "install-startup") {
    if (!rest.includes("--yes")) {
      throw new Error("install-startup changes what runs at logon on this workstation; pass --yes once the owner has agreed");
    }
    const path = installStartup({ node: process.execPath, hostd: fileURLToPath(import.meta.url), root });
    return console.log(`hostd: wrote ${path}`);
  }
  throw new Error("hostd serve | vm status|start|stop|revert <snapshot> | devices list|boot|kill | doctor | install-startup --yes");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((cause) => {
    console.error(cause.message);
    process.exit(1);
  });
}

