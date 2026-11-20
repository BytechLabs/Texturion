import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { adbEnv, foreignSerials, isListening, parseDevices } from "../host/src/adb.mjs";
import { deviceByName, loadContract, serialOf } from "../host/src/config.mjs";
import { APK_DIR, apkRefusal, CURRENT_APK } from "./apk.mjs";

export async function qaAndroid([action, name, output, ...extra], flags, { layout, env, log }) {
  const allowedFlags = { install: ["apk"], screenshot: [], record: ["seconds"] };
  if (!Object.hasOwn(allowedFlags, action) || extra.length > 0 ||
      Object.keys(flags).some((flag) => !allowedFlags[action].includes(flag))) {
    throw new Error("rig qa: see rig --help for install, screenshot and record");
  }
  const install = action === "install";
  if (install ? output !== undefined : !output?.endsWith(action === "record" ? ".mp4" : ".png")) {
    throw new Error("rig qa: install takes no output file, screenshot needs a .png and record needs a .mp4");
  }
  const seconds = Number(flags.seconds ?? 15);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 180) {
    throw new Error("rig qa: --seconds must be an integer from 1 to 180");
  }
  const contract = loadContract();
  const device = deviceByName(contract, name);
  if (!device) throw new Error(`rig qa: choose one of ${contract.devices.map((entry) => entry.name).join(", ")}`);
  const serial = serialOf(device);
  const port = contract.adb.vm_port;
  if (!(await isListening(port))) throw new Error("rig qa: the VM's adb tunnel is down");

  const adb = join(env.ANDROID_HOME || join(homedir(), "android-sdk"), "platform-tools", "adb");
  const run = (args) => {
    const result = spawnSync(adb, ["-H", "127.0.0.1", "-P", String(port), ...args], {
      env: adbEnv(port, env),
      maxBuffer: 16 * 1024 * 1024,
      timeout: (seconds + 60) * 1000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = (result.stderr.length > 0 ? result.stderr : result.stdout).toString().trim();
      throw new Error(`rig qa: adb ${args[0]} exited ${result.status}: ${detail}`);
    }
    return result.stdout;
  };
  const listed = run(["devices"]).toString();
  if (foreignSerials(listed, contract.devices.map(serialOf)).length > 0) {
    throw new Error("rig qa: adb lists a device outside the rig contract; check hostd doctor");
  }
  if (!parseDevices(listed).includes(serial)) throw new Error(`rig qa: ${name} is unavailable; boot it with hostd`);

  const onDevice = (...args) => run(["-s", serial, ...args]);
  if (install) {
    const apk = resolve(flags.apk ?? join(layout.work, APK_DIR, CURRENT_APK));
    const refusal = apkRefusal(apk);
    if (refusal) throw new Error(`rig qa: ${refusal}`);
    log(onDevice("install", "-r", apk).toString().trim());
  } else if (action === "screenshot") {
    writeFileSync(output, onDevice("exec-out", "screencap", "-p"));
    log(resolve(output));
  } else {
    const remote = `/data/local/tmp/rig-qa-${randomUUID()}.mp4`;
    try {
      onDevice("shell", "screenrecord", "--time-limit", String(seconds), remote);
      onDevice("pull", remote, resolve(output));
    } finally {
      onDevice("shell", "rm", "-f", remote);
    }
    log(resolve(output));
  }
  return 0;
}
