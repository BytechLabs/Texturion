// The rig's own adb server, on 5137. Agents on this workstation use the
// default 5037 server for their own devices; nothing here starts, stops or
// queries that one. adb listens on loopback unless given -a, which is never
// passed, and the tunnel carries 5137 into the VM as its 15037.
import { connect } from "node:net";
import { join } from "node:path";

export const AGENTS_PORT = 5037;

export function adbBinary(sdk) {
  return join(sdk, "platform-tools", "adb.exe");
}

function portFlag(port) {
  if (!Number.isInteger(port) || port === AGENTS_PORT) throw new Error(`adb: ${port} is not the rig's adb server port`);
  return ["-P", String(port)];
}

export const startServerArgs = (port) => [...portFlag(port), "start-server"];
export const devicesArgs = (port) => [...portFlag(port), "devices"];

export function bootCompletedArgs(port, serial) {
  if (!/^emulator-\d{4}$/.test(serial)) throw new Error("adb: not an emulator serial");
  return [...portFlag(port), "-s", serial, "shell", "getprop", "sys.boot_completed"];
}

/** adb's environment: the rig's port, and no inherited address or serial. */
export function adbEnv(port, base = process.env) {
  const env = { ...base, ANDROID_ADB_SERVER_PORT: String(port) };
  delete env.ANDROID_ADB_SERVER_ADDRESS;
  delete env.ADB_SERVER_SOCKET;
  delete env.ANDROID_SERIAL;
  return env;
}

/** The serials `adb devices` lists as attached and ready. */
export function parseDevices(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => /^(\S+)\s+device$/.exec(line.trim())?.[1])
    .filter(Boolean);
}

/**
 * Serials `adb devices` lists in any state that are not the contract's: a USB
 * device or another emulator the rig's server picked up, which the VM could
 * then reach through it.
 */
export function foreignSerials(stdout, allowed) {
  return stdout
    .split(/\r?\n/)
    .map((line) => /^(\S+)\t\S/.exec(line)?.[1])
    .filter((serial) => serial && !allowed.includes(serial));
}

export function isListening(port, host = "127.0.0.1", timeoutMs = 1000) {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (up) => {
      socket.destroy();
      done(up);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
