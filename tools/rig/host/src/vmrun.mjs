// vmrun for the rig's own VM and no other. The workstation holds a dozen VMs
// that are not the rig's; every call here names the one configured .vmx, and
// only after that file proves it is the rig's by its marker line. Inventory
// commands are never built, so hostd cannot learn of or reach another VM.
// Guest operations are left out too: they take a guest password on the
// command line, and SSH is how the host drives the VM.
import { readFileSync } from "node:fs";
import { extname, join, relative, resolve, isAbsolute } from "node:path";

import { VMWARE_DIR } from "./config.mjs";

export const VMRUN = join(VMWARE_DIR, "vmrun.exe");
export const MARKER = /^\s*loonext\.rig\s*=\s*"TRUE"\s*$/m;

const SNAPSHOT_NAME = /^[A-Za-z0-9._-]{1,64}$/;

const fold = (path) => (process.platform === "win32" ? path.toLowerCase() : path);

/**
 * The resolved .vmx, once it is under <root>\vm and carries the marker.
 * Throws otherwise, before vmrun is ever started.
 */
export function ownVmx(vmx, { root, readFile = readFileSync }) {
  if (typeof vmx !== "string" || vmx === "") throw new Error("vmrun: no .vmx is configured");
  const path = resolve(vmx);
  const within = relative(fold(resolve(root, "vm")), fold(path));
  if (within === "" || within.startsWith("..") || isAbsolute(within)) {
    throw new Error(`vmrun: ${path} is not under ${resolve(root, "vm")}, so it is not the rig's VM`);
  }
  if (extname(path).toLowerCase() !== ".vmx") throw new Error(`vmrun: ${path} is not a .vmx`);
  let text;
  try {
    text = readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`vmrun: cannot read ${path}: ${cause.code ?? cause.message}`);
  }
  if (!MARKER.test(text)) throw new Error(`vmrun: ${path} has no loonext.rig = "TRUE" line, so it is not the rig's VM`);
  return path;
}

export const startArgs = (vmx) => ["-T", "ws", "start", vmx, "nogui"];
export const stopArgs = (vmx) => ["-T", "ws", "stop", vmx, "soft"];
export const guestIpArgs = (vmx, { wait = true } = {}) => ["-T", "ws", "getGuestIPAddress", vmx, ...(wait ? ["-wait"] : [])];

export function snapshotArgs(vmx, name) {
  if (!SNAPSHOT_NAME.test(name ?? "")) throw new Error("vmrun: a snapshot name is 1-64 letters, digits, dots, dashes or underscores");
  return ["-T", "ws", "snapshot", vmx, name];
}

export function revertArgs(vmx, name) {
  if (!SNAPSHOT_NAME.test(name ?? "")) throw new Error("vmrun: a snapshot name is 1-64 letters, digits, dots, dashes or underscores");
  return ["-T", "ws", "revertToSnapshot", vmx, name];
}

/**
 * Off, or running with the address its tools report. vmrun answers
 * getGuestIPAddress without -wait at once, so it doubles as a status read
 * that names only this VM.
 */
export function parseStatus({ code, stdout, stderr }) {
  const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
  if (code === 0 && /^\d{1,3}(\.\d{1,3}){3}$/.test(out)) return { state: "running", address: out };
  if (/not powered on/i.test(out)) return { state: "off", address: null };
  return { state: "unknown", address: null, detail: out.split(/\r?\n/).pop() ?? "" };
}

/**
 * The VM's controls. `exec(file, args)` resolves to { code, stdout, stderr };
 * each control re-checks the .vmx, so a file swapped after start-up is still
 * refused.
 */
export function vmControls({ vmx, root, exec, readFile = readFileSync }) {
  const run = async (build) => {
    const path = ownVmx(vmx, { root, readFile });
    const result = await exec(VMRUN, build(path));
    if (result.code !== 0) {
      const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split(/\r?\n/).pop();
      throw new Error(`vmrun ${build(path)[2]} failed (${result.code}): ${detail}`);
    }
    return result;
  };
  return {
    start: () => run(startArgs),
    stop: () => run(stopArgs),
    snapshot: (name) => run((path) => snapshotArgs(path, name)),
    revert: (name) => run((path) => revertArgs(path, name)),
    guestIp: async () => (await run(guestIpArgs)).stdout.trim(),
    status: async () => {
      const path = ownVmx(vmx, { root, readFile });
      return parseStatus(await exec(VMRUN, guestIpArgs(path, { wait: false })));
    },
  };
}
