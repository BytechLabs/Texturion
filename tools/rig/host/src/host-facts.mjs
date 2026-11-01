// What the workstation itself says about its readiness, read and never
// changed: the hypervisor, a pending reboot, Windows Update's active hours,
// AC sleep and the rig drive's free space.
import { statfs } from "node:fs/promises";
import { parse } from "node:path";

import { emulatorBinary } from "./emulator.mjs";

export const REBOOT_KEYS = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending",
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired",
];
export const ACTIVE_HOURS_KEY = "HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings";
const REG = "C:\\Windows\\System32\\reg.exe";
const POWERCFG = "C:\\Windows\\System32\\powercfg.exe";

/** `emulator -accel-check`: usable only when it names WHPX as installed and usable. */
export function parseAccelCheck({ code, stdout = "", stderr = "" }) {
  const text = `${stdout}${stderr}`.trim();
  const line = text.split(/\r?\n/).find((entry) => /WHPX|hypervisor|accel/i.test(entry) && !/^accel:?$/i.test(entry.trim()));
  const usable = code === 0 && /WHPX[^\n]*is installed and usable/i.test(text);
  return { usable, detail: (line ?? text.split(/\r?\n/).pop() ?? "").trim() };
}

/** A REG_DWORD value from `reg query`, or null. */
export function parseRegDword(stdout, name) {
  const match = new RegExp(`^\\s*${name}\\s+REG_DWORD\\s+0x([0-9a-f]+)\\s*$`, "im").exec(stdout ?? "");
  return match ? Number.parseInt(match[1], 16) : null;
}

/** `powercfg /q` for sleep-after: the AC index in minutes, 0 meaning never. */
export function parseAcSleepMinutes(stdout) {
  const match = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(stdout ?? "");
  return match ? Math.round(Number.parseInt(match[1], 16) / 60) : null;
}

/** The body of GET /v1/health, which the VM's hostd client reads. */
export function healthReport({ facts, adbUp, tunnel, devices }) {
  return {
    ok: facts.whpx.usable && adbUp && tunnel.up,
    whpx: facts.whpx,
    adb: { listening: adbUp },
    tunnel: { ...tunnel },
    // Unread host facts are reported as a pending reboot, the more cautious reading.
    reboot_pending: facts.host ? facts.host.pending_reboot : true,
    devices,
    host: facts.host,
  };
}

export async function readHostFacts({ exec, sdk, root }) {
  const whpx = parseAccelCheck(await exec(emulatorBinary(sdk), ["-accel-check"]).catch((cause) => ({ code: -1, stderr: cause.message })));

  let pendingReboot = false;
  for (const key of REBOOT_KEYS) {
    const result = await exec(REG, ["query", key]).catch(() => ({ code: 1 }));
    if (result.code === 0) pendingReboot = true;
  }

  const hours = await exec(REG, ["query", ACTIVE_HOURS_KEY]).catch(() => ({ code: 1, stdout: "" }));
  const start = parseRegDword(hours.stdout, "ActiveHoursStart");
  const end = parseRegDword(hours.stdout, "ActiveHoursEnd");

  const power = await exec(POWERCFG, ["/q", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"]).catch(() => ({ code: 1, stdout: "" }));

  let freeGb = null;
  try {
    const stats = await statfs(parse(root).root || root);
    freeGb = Math.round((stats.bavail * stats.bsize) / 1e8) / 10;
  } catch {
    // the drive is absent
  }

  return {
    whpx,
    host: {
      pending_reboot: pendingReboot,
      active_hours: start === null || end === null ? null : { start, end },
      ac_sleep_minutes: parseAcSleepMinutes(power.stdout),
      f_free_gb: freeGb,
    },
  };
}
