/**
 * The rig's emulators, driven over adb. Every device is an emulator on the
 * Windows host; the rig drives no physical phone.
 *
 * Every call goes to the rig's own adb server on the host, through hostd's
 * tunnel at 127.0.0.1:15037, and is refused while that port does not answer:
 * an adb client that finds no server starts one of its own, which in the VM
 * would see no device.
 *
 * Every state a device lane needs is one shell command away: a killed app
 * (`am kill`, which is not force-stop: FCM drops messages to a force-stopped
 * app, so that is a separate case), forced or stepped Doze, a standby bucket,
 * a PIN lock, a reboot. Emulator images ship with Doze off and battery saver
 * holds only on battery, so both are read back rather than assumed. Installs
 * refuse any APK whose package is not `.nonprod`: the production app on a rig
 * device would sign in to production.
 *
 * None of this has run against an emulator yet; the tests pin the commands only.
 */
import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { ADB_VM_PORT } from "./devices.ts";

export const NONPROD_SUFFIX = ".nonprod";
export const STANDBY_BUCKETS = ["active", "working_set", "frequent", "rare", "restricted"] as const;
export type StandbyBucket = (typeof STANDBY_BUCKETS)[number];

const SERVER_CHECK_MS = 2_000;

/** Runs a program with arguments and returns its stdout. Never through a shell. */
export type Exec = (file: string, args: readonly string[], options?: { timeoutMs?: number }) => Promise<string>;

const execFileAsync = promisify(execFile);

export const nodeExec: Exec = async (file, args, options) => {
  const { stdout } = await execFileAsync(file, [...args], {
    timeout: options?.timeoutMs ?? 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
};

/** The adb server every call goes to: hostd's tunnel to the host's rig-only server. */
export interface AdbServer {
  host: "127.0.0.1";
  port: number;
}

export const RIG_ADB_SERVER: AdbServer = { host: "127.0.0.1", port: ADB_VM_PORT };

/** Whether the server answers there within the time. */
export type PortCheck = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

/**
 * Whether an adb server answers there. The tunnel's end in the VM accepts a
 * connection even while nothing listens on the host, so only adb's own OKAY
 * to `host:version` says the server is up.
 */
export const adbAnswers: PortCheck = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    let reply = "";
    const done = (answered: boolean) => {
      socket.destroy();
      resolve(answered);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => socket.write("000chost:version"));
    socket.on("data", (chunk: Buffer) => {
      reply += chunk.toString("latin1");
      if (reply.length >= 4) done(reply.startsWith("OKAY"));
    });
    socket.once("end", () => done(false));
    socket.once("error", () => done(false));
  });

/** RIG_ADB_SERVER's `127.0.0.1:<port>`; anything off loopback is not the tunnel. */
export function parseAdbServer(text: string): AdbServer {
  const match = /^127\.0\.0\.1:(\d{1,5})$/.exec(text.trim());
  const port = Number(match?.[1]);
  if (!match || port < 1 || port > 65_535) throw new Error(`adb: ${text} is not 127.0.0.1:<port>, the tunnel's address`);
  return { host: "127.0.0.1", port };
}

export interface AdbOptions {
  /** `adb devices` serial, `emulator-<console port>`. */
  serial: string;
  adb?: string;
  /** Android build-tools' aapt2, used to read an APK's package before installing it. */
  aapt2?: string;
  exec?: Exec;
  server?: AdbServer;
  portCheck?: PortCheck;
}

export class Adb {
  readonly serial: string;
  readonly #adb: string;
  readonly #aapt2: string;
  readonly #exec: Exec;
  readonly #server: AdbServer;
  readonly #portCheck: PortCheck;

  constructor(options: AdbOptions) {
    if (!/^[A-Za-z0-9.:_-]+$/.test(options.serial)) throw new Error("adb: not a device serial");
    const server = options.server ?? RIG_ADB_SERVER;
    if (server.host !== "127.0.0.1" || !Number.isInteger(server.port) || server.port < 1 || server.port > 65_535) {
      throw new Error("adb: the server is the tunnel's 127.0.0.1:<port>");
    }
    this.serial = options.serial;
    this.#adb = options.adb ?? "adb";
    this.#aapt2 = options.aapt2 ?? "aapt2";
    this.#exec = options.exec ?? nodeExec;
    this.#server = server;
    this.#portCheck = options.portCheck ?? adbAnswers;
  }

  async shell(...args: string[]): Promise<string> {
    return this.#run(this.#shellArgs(args));
  }

  /** Kills the app's process the way Android does under memory pressure. */
  async kill(pkg: string): Promise<void> {
    assertPackage(pkg);
    // `am kill` spares a foreground process, so the app is backgrounded first.
    await this.shell("input", "keyevent", "KEYCODE_HOME");
    await this.shell("am", "kill", pkg);
  }

  async forceStop(pkg: string): Promise<void> {
    assertPackage(pkg);
    await this.shell("am", "force-stop", pkg);
  }

  /** Doze on, light and deep. Emulator images ship it off, and a reboot turns it off again. */
  async enableDoze(): Promise<void> {
    await this.shell("dumpsys", "deviceidle", "enable", "all");
  }

  /**
   * Deep idle now, rather than after the screen has been off for an hour.
   * Throws unless Android says it forced deep idle and then reads IDLE, so a
   * device with Doze off never passes as asleep.
   */
  async forceDoze(): Promise<void> {
    await this.shell("dumpsys", "battery", "unplug");
    await this.enableDoze();
    const forced = await this.shell("dumpsys", "deviceidle", "force-idle");
    if (!forced.includes("Now forced in to deep idle mode")) {
      throw new Error(`adb: force-idle on ${this.serial} did not force deep idle (${firstLine(forced)})`);
    }
    const state = await this.dozeState();
    if (state !== "IDLE") throw new Error(`adb: deep idle on ${this.serial} reads ${state || "nothing"} after force-idle`);
  }

  /**
   * Deep Doze moved state by state, as its timers would move it; an emulator
   * has no motion sensor, so it never gets there by itself. Steps until IDLE,
   * through one maintenance window and back to IDLE, or until the cap, and
   * resolves with every state a step reached.
   */
  async stepDeepIdle(maxSteps = 16): Promise<string[]> {
    await this.enableDoze();
    await this.shell("input", "keyevent", "KEYCODE_SLEEP");
    await this.shell("dumpsys", "battery", "unplug");
    const seen: string[] = [];
    for (let step = 0; step < maxSteps && !passedMaintenance(seen); step++) {
      const out = await this.shell("dumpsys", "deviceidle", "step", "deep");
      const state = /Stepped to deep:\s*([A-Z_]+)/.exec(out)?.[1];
      if (!state) throw new Error(`adb: deviceidle step on ${this.serial} printed no state (${firstLine(out)})`);
      seen.push(state);
    }
    return seen;
  }

  async exitDoze(): Promise<void> {
    await this.shell("dumpsys", "deviceidle", "unforce");
    await this.shell("dumpsys", "battery", "reset");
  }

  async dozeState(): Promise<string> {
    return (await this.shell("dumpsys", "deviceidle", "get", "deep")).trim();
  }

  async setStandbyBucket(pkg: string, bucket: StandbyBucket): Promise<void> {
    assertPackage(pkg);
    if (!STANDBY_BUCKETS.includes(bucket)) throw new Error(`adb: ${String(bucket)} is not a standby bucket`);
    await this.shell("am", "set-standby-bucket", pkg, bucket);
  }

  async standbyBucket(pkg: string): Promise<string> {
    assertPackage(pkg);
    return (await this.shell("am", "get-standby-bucket", pkg)).trim();
  }

  /**
   * Battery saver holds only on battery, so it is turned on unplugged; turned
   * off, the battery goes back to what the emulator reports. Read back either way.
   */
  async batterySaver(on: boolean): Promise<void> {
    if (on) {
      await this.shell("dumpsys", "battery", "unplug");
      await this.shell("settings", "put", "global", "low_power", "1");
    } else {
      await this.shell("settings", "put", "global", "low_power", "0");
      await this.shell("dumpsys", "battery", "reset");
    }
    const read = (await this.shell("settings", "get", "global", "low_power")).trim();
    if (read !== (on ? "1" : "0")) {
      throw new Error(`adb: battery saver on ${this.serial} reads ${read || "nothing"} after turning it ${on ? "on" : "off"}`);
    }
  }

  async lock(): Promise<void> {
    await this.shell("input", "keyevent", "KEYCODE_SLEEP");
  }

  /**
   * A shell command with a secret among its arguments. Node's error for a
   * failed command repeats the whole command line, and verdicts quote errors,
   * so this one names only the step and how it ended.
   */
  async secretShell(step: string, ...args: string[]): Promise<string> {
    const line = this.#withServer(this.#shellArgs(args));
    await this.#serverAnswers();
    try {
      return await this.#exec(this.#adb, line);
    } catch (error) {
      const { code, killed, signal } = error as { code?: unknown; killed?: unknown; signal?: unknown };
      const how = killed ? "timed out" : signal ? `ended by ${String(signal)}` : code !== undefined ? `exited ${String(code)}` : "failed";
      throw new Error(`adb: ${step} on ${this.serial} ${how}`);
    }
  }

  /** Types into the focused field; the text may be a password. */
  async inputText(text: string): Promise<void> {
    await this.secretShell("typing text", "input", "text", text);
  }

  /** Wakes, swipes the keyguard away and types the PIN, as a person would. */
  async unlock(pin: string): Promise<void> {
    assertPin(pin);
    await this.shell("input", "keyevent", "KEYCODE_WAKEUP");
    await this.shell("wm", "dismiss-keyguard");
    await this.secretShell("typing the PIN", "input", "text", pin);
    await this.shell("input", "keyevent", "KEYCODE_ENTER");
  }

  async setPin(pin: string, oldPin?: string): Promise<void> {
    assertPin(pin);
    if (oldPin !== undefined) assertPin(oldPin);
    await this.secretShell("setting the PIN", "locksettings", "set-pin", ...(oldPin ? ["--old", oldPin] : []), pin);
  }

  async isLocked(): Promise<boolean> {
    const out = await this.shell("dumpsys", "window");
    return /mDreamingLockscreen=true|isStatusBarKeyguard=true|mShowingLockscreen=true/.test(out);
  }

  /** Waits until adb sees the device and Android reports boot completed. */
  async waitForBoot(timeoutMs = 5 * 60 * 1000): Promise<void> {
    await this.#run(["-s", this.serial, "wait-for-device"], { timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const booted = await this.shell("getprop", "sys.boot_completed").catch(() => "");
      if (booted.trim() === "1") return;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error("adb: the device did not finish booting");
  }

  /** Reboots and waits until Android reports boot completed. */
  async reboot(timeoutMs = 5 * 60 * 1000): Promise<void> {
    await this.#run(["-s", this.serial, "reboot"]);
    await this.waitForBoot(timeoutMs);
  }

  /**
   * Installs a `.nonprod` APK and nothing else. The APK is copied first and
   * the copy is both checked and installed, so the file cannot change between
   * the check and the install.
   */
  async install(apkPath: string): Promise<string> {
    if (!apkPath.endsWith(".apk")) throw new Error("adb: install takes an .apk file");
    const dir = mkdtempSync(join(tmpdir(), "rig-apk-"));
    const copy = join(dir, basename(apkPath));
    try {
      copyFileSync(apkPath, copy);
      const pkg = (await this.#exec(this.#aapt2, ["dump", "packagename", copy])).trim();
      assertPackage(pkg);
      if (!pkg.endsWith(NONPROD_SUFFIX)) {
        throw new Error(`adb: refusing to install ${pkg}; the rig installs only ${NONPROD_SUFFIX} builds`);
      }
      await this.#run(["-s", this.serial, "install", "-r", copy], { timeoutMs: 5 * 60 * 1000 });
      const installed = await this.shell("pm", "list", "packages", pkg);
      if (!installed.split("\n").some((line) => line.trim() === `package:${pkg}`)) {
        throw new Error(`adb: ${pkg} is not listed after install`);
      }
      return pkg;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * An integer `<meta-data>` entry of an installed app, read from the APK the
   * device holds rather than the one on disk. Null when the manifest has no
   * such entry.
   */
  async manifestInteger(pkg: string, name: string): Promise<number | null> {
    assertPackage(pkg);
    const apk = parsePackagePath(await this.shell("pm", "path", pkg));
    if (!apk) throw new Error(`adb: ${pkg} is not installed`);
    const dir = mkdtempSync(join(tmpdir(), "rig-apk-"));
    const copy = join(dir, "base.apk");
    try {
      await this.#run(["-s", this.serial, "pull", apk, copy], { timeoutMs: 2 * 60 * 1000 });
      const value = manifestMetaValue(await this.#exec(this.#aapt2, ["dump", "xmltree", "--file", "AndroidManifest.xml", copy]), name);
      if (typeof value !== "string") return value;
      const resolved = integerResource(await this.#exec(this.#aapt2, ["dump", "resources", copy]), value);
      if (resolved === null) throw new Error(`adb: ${name} names ${value}, which the APK's resource table does not hold as an integer`);
      return resolved;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async #run(args: readonly string[], options?: { timeoutMs?: number }): Promise<string> {
    await this.#serverAnswers();
    return this.#exec(this.#adb, this.#withServer(args), options);
  }

  async #serverAnswers(): Promise<void> {
    const { host, port } = this.#server;
    if (!(await this.#portCheck(host, port, SERVER_CHECK_MS))) {
      throw new Error(`adb: the rig's adb server (hostd tunnel ${host}:${port}) is not answering`);
    }
  }

  #withServer(args: readonly string[]): string[] {
    return ["-H", this.#server.host, "-P", String(this.#server.port), ...args];
  }

  #shellArgs(args: readonly string[]): string[] {
    for (const arg of args) {
      if (!/^[A-Za-z0-9._:/=+@%,-]+$/.test(arg)) throw new Error(`adb: refusing a shell argument with special characters`);
    }
    return ["-s", this.serial, "shell", ...args];
  }
}

/** Whether a stepped Doze went IDLE, through a maintenance window, and back to IDLE. */
export function passedMaintenance(states: readonly string[]): boolean {
  const idle = states.indexOf("IDLE");
  const maintenance = idle === -1 ? -1 : states.indexOf("IDLE_MAINTENANCE", idle);
  return maintenance !== -1 && states.indexOf("IDLE", maintenance) !== -1;
}

/** The APK `pm path` names for a package: the base one when the app is split. */
export function parsePackagePath(output: string): string | null {
  const paths = output
    .split("\n")
    .map((line) => /^package:(\S+\.apk)$/.exec(line.trim())?.[1])
    .filter((path): path is string => path !== undefined);
  return paths.find((path) => path.endsWith("/base.apk")) ?? paths[0] ?? null;
}

/**
 * A `<meta-data>` value in `aapt2 dump xmltree` output: the number when the
 * manifest states one, the resource id (`0x7f0b0005`) when it names one, and
 * null when there is no entry by that name.
 */
export function manifestMetaValue(xmltree: string, name: string): number | string | null {
  for (const element of xmltree.replace(/\r\n/g, "\n").split(/\n(?=\s*E: )/)) {
    if (!/^\s*E: meta-data\b/.test(element) || !element.includes(`="${name}"`)) continue;
    const value = /:value\(0x[0-9a-f]+\)=(.+)$/im.exec(element)?.[1]?.trim();
    if (!value) return null;
    const reference = /^@(0x[0-9a-f]{8})$/i.exec(value)?.[1];
    if (reference) return reference.toLowerCase();
    // aapt2 prints a typed integer as `(type 0x10)0x...`, decimal and hex alike.
    const typed = /^\(type 0x1[01]\)(0x[0-9a-f]+)$/i.exec(value)?.[1];
    if (typed) return Number.parseInt(typed, 16);
    const plain = /^"?(\d+)"?$/.exec(value)?.[1];
    return plain ? Number(plain) : null;
  }
  return null;
}

/** An integer resource's default value in `aapt2 dump resources` output, by its id. */
export function integerResource(dump: string, id: string): number | null {
  if (!/^0x[0-9a-f]{8}$/i.test(id)) throw new Error("adb: not a resource id");
  const lines = dump.replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((line) => line.trim().toLowerCase().startsWith(`resource ${id.toLowerCase()} `));
  if (at === -1) return null;
  for (const line of lines.slice(at + 1)) {
    if (/^\s*(resource|type|Package)\b/.test(line)) break;
    const value = /^\s*\(\)\s+(?:\([a-z]+\)\s+)?(0x[0-9a-f]+|\d+)\s*$/i.exec(line)?.[1];
    if (value) return value.startsWith("0x") ? Number.parseInt(value, 16) : Number(value);
  }
  return null;
}

function firstLine(output: string): string {
  return output.trim().split("\n")[0]?.trim().slice(0, 120) || "no output";
}

function assertPackage(pkg: string): void {
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(pkg)) throw new Error("adb: not an Android package name");
}

function assertPin(pin: string): void {
  if (!/^\d{4,12}$/.test(pin)) throw new Error("adb: a PIN is 4 to 12 digits");
}
