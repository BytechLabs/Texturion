// The emulators run here on the workstation, under WHPX: the VM has no nested
// virtualisation while Hyper-V is on, and an accelerated emulator cannot run
// inside another VM. hostd starts and stops them; the VM's lanes reach their
// adb, console and gRPC ports through the tunnel.
import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import { bootCompletedArgs, adbBinary, adbEnv } from "./adb.mjs";
import { deviceByName, serialOf } from "./config.mjs";

/**
 * The emulator's audio flag, decided by spike EA1: null, the default audio
 * backend, which gRPC injectAudio and streamAudio passed with. "-no-audio"
 * failed: injectAudio answers "There can be only one microphone active".
 * -allow-host-audio is never allowed: it feeds the workstation's real
 * microphone into the device.
 */
export const AUDIO_FLAG = null;
const AUDIO_FLAGS = new Set([null, "-no-audio"]);

// The process a discovery file names; emulator.exe is only its launcher.
export const EMULATOR_IMAGE = /^qemu-system-[a-z0-9_]+(?:-headless)?(?:\.exe)?$/i;
// File times and process start times are not taken at the same instant.
const CLOCK_SLACK_MS = 2000;

export const BOOT_TIMEOUT_MS = 5 * 60 * 1000;
export const KILL_TIMEOUT_MS = 30 * 1000;
const POLL_MS = 2000;

export function emulatorBinary(sdk) {
  return join(sdk, "emulator", "emulator.exe");
}

export function emulatorArgs(device, { dnsServer, cold = false, wipe = false, audio = AUDIO_FLAG }) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(device.avd ?? "")) throw new Error("emulator: not an AVD name");
  const { console: consolePort, grpc } = device;
  if (!Number.isInteger(consolePort) || consolePort < 5554 || consolePort > 5682 || consolePort % 2) {
    throw new Error("emulator: console ports are even, 5554-5682");
  }
  if (!Number.isInteger(grpc) || grpc < 1024 || grpc > 65535) throw new Error("emulator: not a gRPC port");
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(dnsServer ?? "")) throw new Error("emulator: the DNS server is the VM's address");
  if (!AUDIO_FLAGS.has(audio)) throw new Error(`emulator: ${audio} is not an allowed audio flag`);
  return [
    "-avd", device.avd,
    "-port", String(consolePort),
    "-grpc", String(grpc),
    "-grpc-use-token",
    "-no-window",
    "-no-boot-anim",
    "-no-snapshot-save",
    "-gpu", "swiftshader_indirect",
    // A missing hypervisor fails the boot instead of falling back to a
    // software CPU that never finishes booting.
    "-accel", "on",
    "-dns-server", dnsServer,
    ...(cold || wipe ? ["-no-snapshot-load"] : []),
    ...(wipe ? ["-wipe-data"] : []),
    ...(audio ? [audio] : []),
  ];
}

/**
 * The rig's own SDK, AVD and emulator homes, and its adb server. Variables an
 * agent's shell may carry that would point the emulator elsewhere are dropped.
 */
export function emulatorEnv({ paths, sdk, adbPort, base = process.env }) {
  const env = adbEnv(adbPort, base);
  for (const name of ["ANDROID_HOME", "ANDROID_SDK_HOME", "ANDROID_USER_HOME", "ANDROID_PREFS_ROOT"]) delete env[name];
  return {
    ...env,
    ANDROID_SDK_ROOT: sdk,
    ANDROID_AVD_HOME: paths.avd,
    ANDROID_EMULATOR_HOME: paths.emulatorHome,
  };
}

/** Where the console token may be, in the order the emulator is believed to use. */
export function consoleTokenPaths(paths, env = process.env) {
  return [
    join(paths.emulatorHome, ".emulator_console_auth_token"),
    ...(env.USERPROFILE ? [join(env.USERPROFILE, ".emulator_console_auth_token")] : []),
  ];
}

/**
 * Where a running emulator advertises itself (pid_<pid>.ini). Unmeasured on
 * this host until the first boot; `hostd doctor` reports which one held it.
 */
export function discoveryDirs(paths, env = process.env) {
  const dirs = [];
  if (env.TEMP) dirs.push(join(env.TEMP, "avd", "running"));
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, "Temp", "avd", "running"));
  dirs.push(join(paths.emulatorHome, "avd", "running"));
  return [...new Set(dirs)];
}

export function parseIni(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^=#;\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/**
 * The newest discovery file naming this device's AVD, console port and gRPC
 * port. Its pid is the emulator process itself, which on Windows is not the
 * launcher hostd spawned. A hard kill leaves the file behind, so an older
 * match can name a pid Windows has since given to another process.
 */
export function findDiscovery(device, dirs, { readdir = readdirSync, readFile = readFileSync, stat = statSync } = {}) {
  let newest = null;
  for (const dir of dirs) {
    let names;
    try {
      names = readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const pid = /^pid_(\d+)(?:_info)?\.ini$/.exec(name)?.[1];
      if (!pid) continue;
      let ini;
      try {
        ini = parseIni(readFile(join(dir, name), "utf8"));
      } catch {
        continue;
      }
      if (Number(ini["grpc.port"]) !== device.grpc) continue;
      if (Number(ini["port.serial"]) !== device.console) continue;
      if (ini["avd.name"] !== device.avd) continue;
      let mtimeMs;
      try {
        mtimeMs = stat(join(dir, name)).mtimeMs;
      } catch {
        continue;
      }
      if (newest && newest.mtimeMs >= mtimeMs) continue;
      newest = { path: join(dir, name), pid: Number(pid), grpcToken: ini["grpc.token"] || null, mtimeMs };
    }
  }
  return newest;
}

/** The image name and start time of a pid, or null when no process holds it. */
export async function readProcessInfo(exec, pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const script = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.ProcessName; $p.StartTime.ToUniversalTime().ToString('o') }`;
  const result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]).catch(() => null);
  const [image, started] = (result?.code === 0 ? result.stdout : "").trim().split(/\r?\n/);
  const startedMs = Date.parse(started ?? "");
  return image && Number.isFinite(startedMs) ? { image: image.trim(), startedMs } : null;
}

export function readConsoleToken(paths, env = process.env, readFile = readFileSync) {
  for (const path of consoleTokenPaths(paths, env)) {
    try {
      const token = readFile(path, "utf8").trim();
      if (token) return { path, token };
    } catch {
      // the next candidate
    }
  }
  return null;
}

/** One command on the emulator's console, after `auth`. */
export function consoleCommand(port, token, command, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: "127.0.0.1" });
    let buffer = "";
    let step = 0;
    const fail = (message) => {
      socket.destroy();
      reject(new Error(`console ${port}: ${message}`));
    };
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => fail("no answer"));
    socket.on("error", (cause) => fail(cause.code ?? cause.message));
    socket.on("close", () => {
      if (step === 2) resolve();
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (/^KO\b/m.test(buffer)) return fail(step === 0 ? "refused the token" : `refused ${command}`);
      if (!/^OK\s*$/m.test(buffer)) return;
      buffer = "";
      if (step === 0) {
        step = 1;
        socket.write(`auth ${token}\r\n`);
      } else if (step === 1) {
        step = 2;
        socket.write(`${command}\r\n`);
      } else {
        socket.end();
      }
    });
  });
}

const reply = (status, body) => ({ status, body });

/**
 * The supervisor's view of every contract device: off, booting or booted,
 * with the emulator's pid once its discovery file names it.
 */
export function createDevices({
  contract,
  paths,
  sdk,
  spawn,
  exec,
  env = process.env,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  now = () => Date.now(),
  isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  // TerminateProcess on Windows: the power-loss analogue.
  killPid = (pid) => process.kill(pid, "SIGKILL"),
  discover = (device) => findDiscovery(device, discoveryDirs(paths, env)),
  processInfo = (pid) => readProcessInfo(exec, pid),
  removeFile = unlinkSync,
  consoleToken = () => readConsoleToken(paths, env),
  sendConsole = consoleCommand,
  log = () => {},
  bootTimeoutMs = BOOT_TIMEOUT_MS,
  killTimeoutMs = KILL_TIMEOUT_MS,
  pollMs = POLL_MS,
}) {
  const adb = adbBinary(sdk);
  const adbPort = contract.adb.server_port;
  const entries = new Map(
    contract.devices.map((device) => [device.name, { device, state: "off", launcher: null, pid: null, emulator: null, booting: null }]),
  );

  const bootCompleted = async (device) => {
    // A missing adb rejects; that is not booted, and must not crash hostd.
    const result = await exec(adb, bootCompletedArgs(adbPort, serialOf(device)), { env: adbEnv(adbPort, env) }).catch(() => null);
    return result?.code === 0 && result.stdout.trim() === "1";
  };

  const settle = (entry) => {
    entry.state = "off";
    entry.launcher = null;
    entry.pid = null;
    entry.emulator = null;
  };

  const isEmulator = (info) => info !== null && EMULATOR_IMAGE.test(info.image);

  /**
   * The emulator a discovery file names, as { pid, startedMs, path }: a
   * qemu-system process that was already running when the file was written.
   * A pid and its start time name one process; a pid alone can be reused.
   * "unverified" is a live pid that fails that check.
   */
  const identify = async (found) => {
    if (!found || !isAlive(found.pid)) return null;
    const info = await processInfo(found.pid);
    if (!isEmulator(info) || info.startedMs > found.mtimeMs + CLOCK_SLACK_MS) return "unverified";
    return { pid: found.pid, startedMs: info.startedMs, path: found.path };
  };

  const stillRunning = async (emulator) => {
    if (!emulator || !isAlive(emulator.pid)) return false;
    const info = await processInfo(emulator.pid);
    return isEmulator(info) && Math.abs(info.startedMs - emulator.startedMs) <= CLOCK_SLACK_MS;
  };

  /** Takes the device's emulator from its discovery file; false when a live pid fails the check. */
  const refresh = async (entry) => {
    const identified = await identify(discover(entry.device));
    if (identified === "unverified") return false;
    if (identified) {
      entry.emulator = identified;
      entry.pid = identified.pid;
    }
    return true;
  };

  // The launcher is hostd's own child, whose pid stays held until it exits.
  const gone = async (entry) =>
    entry.state === "off" || (!(entry.launcher && isAlive(entry.launcher.pid)) && !(await stillRunning(entry.emulator)));

  async function waitBooted(entry) {
    const started = now();
    while (now() - started < bootTimeoutMs) {
      if (entry.state === "off") return reply(502, { error: "emulator.exited" });
      if (await bootCompleted(entry.device)) {
        entry.state = "booted";
        await refresh(entry);
        log(`device ${entry.device.name} booted`);
        return reply(200, { state: "booted" });
      }
      await sleep(pollMs);
    }
    log(`device ${entry.device.name} did not finish booting in ${bootTimeoutMs / 1000} s`);
    return reply(504, { error: "boot.timeout" });
  }

  async function boot(name, { cold = false, wipe = false } = {}) {
    const entry = entries.get(name);
    if (!entry) return reply(404, { error: "device.unknown" });
    if (entry.state === "booted") {
      return cold || wipe ? reply(409, { error: "device.running" }) : reply(200, { state: "booted" });
    }
    if (entry.state === "booting") {
      // An adopted emulator that was still booting has no wait of its own yet.
      entry.booting ??= waitBooted(entry).finally(() => {
        entry.booting = null;
      });
      return entry.booting;
    }
    const active = [...entries.values()].filter((other) => other.state !== "off").length;
    if (active >= contract.max_booted) return reply(409, { error: "max_booted", max_booted: contract.max_booted });

    const args = emulatorArgs(entry.device, { dnsServer: contract.vm.address, cold, wipe });
    const child = spawn(emulatorBinary(sdk), args, {
      env: emulatorEnv({ paths, sdk, adbPort, base: env }),
      stdio: "ignore",
      windowsHide: true,
      // Outside hostd's job object, so a hostd restart leaves the device
      // running for the next hostd to adopt.
      detached: true,
    });
    entry.state = "booting";
    entry.launcher = child;
    entry.pid = child.pid ?? null;
    entry.emulator = null;
    child.once("exit", (code) => {
      if (entry.launcher !== child) return;
      log(`device ${name} emulator exited (${code})`);
      settle(entry);
    });
    child.once("error", (cause) => {
      if (entry.launcher !== child) return;
      log(`device ${name} emulator did not start: ${cause.code ?? cause.message}`);
      settle(entry);
    });
    log(`device ${name} booting${cold ? " cold" : ""}${wipe ? " wiped" : ""}`);
    entry.booting = waitBooted(entry).finally(() => {
      entry.booting = null;
    });
    return entry.booting;
  }

  async function kill(name, { hard = false } = {}) {
    const entry = entries.get(name);
    if (!entry) return reply(404, { error: "device.unknown" });
    if (entry.state === "off") return reply(200, { state: "off" });
    if (hard) {
      if (!(await refresh(entry))) {
        log(`device ${name} hard kill refused: its discovery file names a pid that is not its emulator`);
        return reply(409, { error: "pid.unverified" });
      }
      const pids = [];
      if (await stillRunning(entry.emulator)) pids.push(entry.emulator.pid);
      if (Number.isInteger(entry.launcher?.pid)) pids.push(entry.launcher.pid);
      for (const pid of new Set(pids)) {
        try {
          killPid(pid);
        } catch {
          // already gone
        }
      }
    } else {
      const token = consoleToken();
      if (!token) return reply(503, { error: "console_token.unavailable" });
      try {
        await sendConsole(entry.device.console, token.token, "kill");
      } catch (cause) {
        log(`device ${name} console kill failed: ${cause.message}`);
        return reply(502, { error: "console.failed" });
      }
    }
    // The launcher's exit clears entry.emulator during the wait.
    const killed = entry.emulator;
    const started = now();
    while (!(await gone(entry))) {
      if (now() - started >= killTimeoutMs) return reply(504, { error: "kill.timeout" });
      await sleep(Math.min(pollMs, 500));
    }
    // A terminated emulator never removes its own file.
    if (hard && killed) {
      try {
        removeFile(killed.path);
      } catch {
        // already removed
      }
    }
    settle(entry);
    log(`device ${name} killed${hard ? " hard" : ""}`);
    return reply(200, { state: "off" });
  }

  function tokens(name) {
    const entry = entries.get(name);
    if (!entry) return reply(404, { error: "device.unknown" });
    if (entry.state === "off") return reply(409, { error: "device.off" });
    const consoleFound = consoleToken();
    const grpcToken = discover(entry.device)?.grpcToken ?? null;
    if (!consoleFound || !grpcToken) return reply(503, { error: "token.unavailable" });
    return reply(200, { console_token: consoleFound.token, grpc_token: grpcToken });
  }

  /** Emulators a previous hostd started, still running, are taken back. */
  async function adopt() {
    for (const entry of entries.values()) {
      if (entry.state !== "off") continue;
      const identified = await identify(discover(entry.device));
      if (identified === "unverified") log(`device ${entry.device.name} not adopted: its discovery file names a pid that is not its emulator`);
      if (!identified || identified === "unverified") continue;
      entry.emulator = identified;
      entry.pid = identified.pid;
      entry.state = (await bootCompleted(entry.device)) ? "booted" : "booting";
      log(`device ${entry.device.name} adopted (${entry.state})`);
    }
  }

  function list() {
    for (const entry of entries.values()) {
      if (entry.state !== "off" && !entry.launcher && entry.pid && !isAlive(entry.pid)) settle(entry);
    }
    return [...entries.values()].map(({ device, state, pid }) => ({ name: device.name, serial: serialOf(device), state, pid }));
  }

  return { boot, kill, tokens, adopt, list, has: (name) => deviceByName(contract, name) !== null };
}
