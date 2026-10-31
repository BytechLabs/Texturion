/**
 * The Pixel and the emulators, driven over adb.
 *
 * Every state a device lane needs is one shell command away: a killed app
 * (`am kill`, which is not force-stop: FCM drops messages to a force-stopped
 * app, so that is a separate case), forced Doze, a standby bucket, a PIN lock,
 * a reboot. Installs refuse any APK whose package is not `.nonprod`: the
 * production app on a rig phone would sign in to production.
 *
 * None of this has run against hardware yet; the tests pin the commands only.
 */
import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

export const NONPROD_SUFFIX = ".nonprod";
export const STANDBY_BUCKETS = ["active", "working_set", "frequent", "rare", "restricted"] as const;
export type StandbyBucket = (typeof STANDBY_BUCKETS)[number];

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

export interface AdbOptions {
  /** `adb devices` serial: the Pixel's, or `emulator-5554`. */
  serial: string;
  adb?: string;
  /** Android build-tools' aapt2, used to read an APK's package before installing it. */
  aapt2?: string;
  exec?: Exec;
}

export class Adb {
  readonly serial: string;
  readonly #adb: string;
  readonly #aapt2: string;
  readonly #exec: Exec;

  constructor(options: AdbOptions) {
    if (!/^[A-Za-z0-9.:_-]+$/.test(options.serial)) throw new Error("adb: not a device serial");
    this.serial = options.serial;
    this.#adb = options.adb ?? "adb";
    this.#aapt2 = options.aapt2 ?? "aapt2";
    this.#exec = options.exec ?? nodeExec;
  }

  async shell(...args: string[]): Promise<string> {
    for (const arg of args) {
      if (!/^[A-Za-z0-9._:/=+@%,-]+$/.test(arg)) throw new Error(`adb: refusing a shell argument with special characters`);
    }
    return this.#exec(this.#adb, ["-s", this.serial, "shell", ...args]);
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

  /** Deep idle now, rather than after the screen has been off for an hour. */
  async forceDoze(): Promise<void> {
    await this.shell("dumpsys", "battery", "unplug");
    await this.shell("dumpsys", "deviceidle", "force-idle");
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

  async batterySaver(on: boolean): Promise<void> {
    await this.shell("settings", "put", "global", "low_power", on ? "1" : "0");
  }

  async lock(): Promise<void> {
    await this.shell("input", "keyevent", "KEYCODE_SLEEP");
  }

  /** Wakes, swipes the keyguard away and types the PIN, as a person would. */
  async unlock(pin: string): Promise<void> {
    assertPin(pin);
    await this.shell("input", "keyevent", "KEYCODE_WAKEUP");
    await this.shell("wm", "dismiss-keyguard");
    await this.shell("input", "text", pin);
    await this.shell("input", "keyevent", "KEYCODE_ENTER");
  }

  async setPin(pin: string, oldPin?: string): Promise<void> {
    assertPin(pin);
    if (oldPin !== undefined) assertPin(oldPin);
    await this.shell("locksettings", "set-pin", ...(oldPin ? ["--old", oldPin] : []), pin);
  }

  async isLocked(): Promise<boolean> {
    const out = await this.shell("dumpsys", "window");
    return /mDreamingLockscreen=true|isStatusBarKeyguard=true|mShowingLockscreen=true/.test(out);
  }

  /** Reboots and waits until Android reports boot completed. */
  async reboot(timeoutMs = 5 * 60 * 1000): Promise<void> {
    await this.#exec(this.#adb, ["-s", this.serial, "reboot"]);
    await this.#exec(this.#adb, ["-s", this.serial, "wait-for-device"], { timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const booted = await this.shell("getprop", "sys.boot_completed").catch(() => "");
      if (booted.trim() === "1") return;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error("adb: the device did not finish booting");
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
      await this.#exec(this.#adb, ["-s", this.serial, "install", "-r", copy], { timeoutMs: 5 * 60 * 1000 });
      const installed = await this.shell("pm", "list", "packages", pkg);
      if (!installed.split("\n").some((line) => line.trim() === `package:${pkg}`)) {
        throw new Error(`adb: ${pkg} is not listed after install`);
      }
      return pkg;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Headless KVM emulators with Google Play images (API 34, 35 and 36). */
export function emulatorArgs(avd: string, port: number): string[] {
  if (!/^[A-Za-z0-9._-]+$/.test(avd)) throw new Error("emulator: not an AVD name");
  if (!Number.isInteger(port) || port < 5554 || port > 5682 || port % 2) throw new Error("emulator: console ports are even, 5554-5682");
  return ["-avd", avd, "-port", String(port), "-no-window", "-no-snapshot-save", "-no-boot-anim", "-gpu", "swiftshader_indirect"];
}

function assertPackage(pkg: string): void {
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(pkg)) throw new Error("adb: not an Android package name");
}

function assertPin(pin: string): void {
  if (!/^\d{4,12}$/.test(pin)) throw new Error("adb: a PIN is 4 to 12 digits");
}
