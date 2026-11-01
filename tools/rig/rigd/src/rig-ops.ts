/**
 * The rig box as scenarios drive it: its health report, the relay's record of
 * the local API's Sentry events, the fault the next call event gets, the
 * Pixel's network, and the Android devices.
 *
 * Health is the rig CLI's own `rig health` (tools/rig/src/health.mjs), run
 * fresh and read back from `state/health.json`, so R00 and an agent at the
 * terminal see one report.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AccessPointShaper,
  AndroidDevice,
  BluetoothAudioLink,
  emulatorArgs,
  nodeExec,
  nodeSpawn,
  UsbHub,
  type Exec,
  type NetworkImpairment,
  type Spawn,
  type Spawned,
} from "@loonext/rig-lanes";
import type { NumberBook, Transcriber } from "@loonext/rig-robot";
import type { SeenEvent } from "./sentry-relay.ts";
import type { FaultFile } from "./state-files.ts";
import type { AudioLinkApi, DeviceApi, DevicesApi, RigApi, RigHealthReport } from "./scenarios/context.ts";

export interface RigOpsOptions {
  /** `$RIG_HOME/state`, where `rig health` writes health.json. */
  stateDir: string;
  /** tools/rig/bin/rig.mjs in the tooling checkout. */
  rigBin: string;
  /** The relay's counters file, whose `apiSeen` holds the local API's events. */
  relayState: string;
  faults: FaultFile;
  shaper?: AccessPointShaper;
  transcriber?: Transcriber;
  exec?: (file: string, args: readonly string[]) => Promise<void>;
}

const runNode = (file: string, args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: 5 * 60_000 }, (error) => (error && error.code !== 1 ? reject(error) : resolve()));
  });

export class RigOps implements RigApi {
  readonly #o: RigOpsOptions;

  constructor(options: RigOpsOptions) {
    this.#o = options;
  }

  /** `rig health` exits 1 when a check fails, and still writes the report a failing R00 needs. */
  async health(): Promise<RigHealthReport> {
    await (this.#o.exec ?? runNode)(process.execPath, [this.#o.rigBin, "health"]);
    const path = join(this.#o.stateDir, "health.json");
    if (!existsSync(path)) throw new Error("rig health wrote no state/health.json");
    return JSON.parse(readFileSync(path, "utf8")) as RigHealthReport;
  }

  async apiEvents(since: number): Promise<SeenEvent[]> {
    if (!existsSync(this.#o.relayState)) return [];
    const state = JSON.parse(readFileSync(this.#o.relayState, "utf8")) as { apiSeen?: Record<string, number | SeenEvent> };
    return Object.values(state.apiSeen ?? {})
      .map((value) => (typeof value === "number" ? { at: value } : value))
      .filter((event) => event.at >= since)
      .sort((a, b) => a.at - b.at);
  }

  async failNextCallEvent(status: 503): Promise<void> {
    this.#o.faults.arm(status);
  }

  async impairNetwork(impairment: NetworkImpairment | null): Promise<void> {
    if (!this.#o.shaper) throw new Error("rig: no access point interface is configured");
    await this.#o.shaper.impair(impairment);
  }

  async networkOutage(ms: number): Promise<void> {
    if (!this.#o.shaper) throw new Error("rig: no access point interface is configured");
    await this.#o.shaper.outage(ms);
  }

  async transcribe(audio: Uint8Array): Promise<string> {
    if (!this.#o.transcriber) throw new Error("rig: whisper.cpp is not configured (RIG_WHISPER_BIN, RIG_WHISPER_MODEL)");
    return this.#o.transcriber.transcribe(audio);
  }
}

export interface DeviceSettings {
  pkg: string;
  apks: { current: string; previous: string };
  pin: () => string | undefined;
  pixel?: {
    serial: string;
    hub?: { location: string; port: number };
    bluetooth?: { mac: string; nodes: { callSource: string; callSink: string; mediaSource: string } };
  };
  /** The AVD names by API level, and the console port each runs on. */
  emulators: Record<34 | 35 | 36, { avd: string; port: number }>;
  fakeMicDir: string;
  transcriber?: Transcriber;
  numbers: NumberBook;
  /** The seed's sign-in for a member key. */
  credentials: (member: string) => { email: string; password: string } | undefined;
  exec?: Exec;
  spawn?: Spawn;
}

/** The devices, built when a scenario first asks; a missing Pixel is an error the runner reports as infra. */
export function rigDevices(settings: DeviceSettings): DevicesApi {
  const exec = settings.exec ?? nodeExec;
  const spawn = settings.spawn ?? nodeSpawn;
  const running = new Map<number, Spawned>();
  const device = (name: string, serial: string, audio?: AudioLinkApi): DeviceApi => {
    const android = new AndroidDevice({ name, serial, pkg: settings.pkg, pin: settings.pin, apks: settings.apks, exec });
    const api: DeviceApi = {
      name,
      reachable: () => android.reachable(),
      state: () => android.state(),
      kill: () => android.kill(),
      forceStop: () => android.forceStop(),
      forceDoze: () => android.forceDoze(),
      exitDoze: () => android.exitDoze(),
      idleNaturally: () => android.idleNaturally(),
      setStandbyBucket: (bucket) => android.setStandbyBucket(bucket),
      batterySaver: (on) => android.batterySaver(on),
      hibernate: (on) => android.hibernate(on),
      notificationsAllowed: (on) => android.notificationsAllowed(on),
      lock: () => android.lock(),
      unlock: () => android.unlock(),
      reboot: (options) => android.reboot(options),
      install: (build) => android.install(build),
      uninstall: () => android.uninstall(),
      launch: (path) => android.launch(path),
      waitForRinging: (ms) => android.waitForRinging(ms),
      callState: () => android.callState(),
      tap: (id) => android.tap(id),
      showing: (target) => android.showing(target),
      tapText: (text) => android.tapText(text),
      type: (text) => android.type(text),
      signIn: (member) => signInOnDevice(android, member, settings.credentials(member)),
      dial: (role) => dialOnDevice(android, role, settings.numbers),
      ...(audio ? { audio } : {}),
    };
    return api;
  };
  const emulatorSerial = (api: 34 | 35 | 36) => `emulator-${settings.emulators[api].port}`;
  return {
    pixel() {
      const pixel = settings.pixel;
      if (!pixel) throw new Error("rig: the store names no Pixel serial");
      let audio: AudioLinkApi | undefined;
      if (pixel.bluetooth) {
        const link = new BluetoothAudioLink({ ...pixel.bluetooth, fakeMicDir: settings.fakeMicDir, exec, spawn, transcriber: settings.transcriber });
        audio = {
          connected: () => link.connected(),
          playCode: (surface) => link.playCode(surface),
          stop: async () => link.stop(),
          hear: (args) => link.hear(args),
          transcribe: (args) => link.transcribe(args),
        };
      }
      return device("pixel", pixel.serial, audio);
    },
    emulator(api) {
      return device(`emulator-${api}`, emulatorSerial(api));
    },
    async bootEmulator(api) {
      if (running.has(api)) return;
      const { avd, port } = settings.emulators[api];
      running.set(api, spawn("emulator", emulatorArgs(avd, port), () => running.delete(api)));
      await exec("adb", ["-s", emulatorSerial(api), "wait-for-device"], { timeoutMs: 5 * 60_000 });
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        const booted = await exec("adb", ["-s", emulatorSerial(api), "shell", "getprop", "sys.boot_completed"]).catch(() => "");
        if (booted.trim() === "1") return;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new Error(`rig: the API ${api} emulator did not finish booting`);
    },
    async shutdownEmulator(api) {
      await exec("adb", ["-s", emulatorSerial(api), "emu", "kill"]).catch(() => "");
      running.get(api)?.stop();
      running.delete(api);
    },
    async powerCycle() {
      const hub = settings.pixel?.hub;
      if (!hub) throw new Error("rig: the store names no USB hub port for the Pixel");
      await new UsbHub({ ...hub, exec }).powerCycle();
    },
  };
}

/** The app's sign-in screen as a member fills it in, its fields and button found by their English labels. */
export async function signInOnDevice(
  device: Pick<AndroidDevice, "launch" | "showing" | "tapText" | "type">,
  member: string,
  credentials: { email: string; password: string } | undefined,
): Promise<boolean> {
  if (!credentials) throw new Error(`rig: no sign-in for ${member}`);
  await device.launch();
  if (!(await device.showing({ text: "Email" }))) return false;
  for (const [field, value] of [
    ["Email", credentials.email],
    ["Password", credentials.password],
  ] as const) {
    if (!(await device.tapText(field))) return false;
    await device.type(value);
  }
  return device.tapText("Sign in");
}

/** The app's dialer: the role's digits on its keypad, then Call. */
export async function dialOnDevice(device: Pick<AndroidDevice, "launch" | "tapText">, role: string, numbers: NumberBook): Promise<void> {
  const number = numbers.number(role);
  if (!number) throw new Error(`rig: no number for ${role}`);
  await device.launch("/calls");
  if (!(await device.tapText("Dial"))) throw new Error("rig: the app's calls screen offered no dialer");
  for (const digit of number.replace(/^\+1/, "")) {
    if (!(await device.tapText(digit))) throw new Error("rig: the dialer's keypad is not on screen");
  }
  if (!(await device.tapText("Call"))) throw new Error("rig: the dialer offered no Call button");
}
