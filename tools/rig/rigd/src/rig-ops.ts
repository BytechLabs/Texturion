/**
 * The rig VM as scenarios drive it: its health report, the relay's record of
 * the local API's Sentry events, the fault the next call event gets, and the
 * Android emulators.
 *
 * Health is the rig CLI's own `rig health` (tools/rig/src/health.mjs), run
 * fresh and read back from `state/health.json`, so R00 and an agent at the
 * terminal see one report.
 *
 * The emulators run on the Windows host. hostd starts and stops them, and
 * every adb, console and gRPC call reaches them through its tunnel, so the VM
 * never runs an emulator itself.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AndroidDevice,
  EmulatorAudioLink,
  EmulatorConsole,
  MAX_BOOTED,
  nodeExec,
  RIG_DEVICE_NAMES,
  RIG_DEVICES,
  type AdbServer,
  type ControllerClient,
  type Exec,
  type HostdClient,
  type PortCheck,
  type RigDeviceName,
} from "@loonext/rig-lanes";
import type { NumberBook, Transcriber } from "@loonext/rig-robot";
import type { Socket } from "node:net";
import type { SeenEvent } from "./sentry-relay.ts";
import type { FaultFile } from "./state-files.ts";
import type { DeviceApi, DevicesApi, RigApi, RigHealthReport } from "./scenarios/context.ts";

export interface RigOpsOptions {
  /** `$RIG_HOME/state`, where `rig health` writes health.json. */
  stateDir: string;
  /** tools/rig/bin/rig.mjs in the tooling checkout. */
  rigBin: string;
  /** The relay's counters file, whose `apiSeen` holds the local API's events. */
  relayState: string;
  faults: FaultFile;
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

  async disarmCallEventFault(): Promise<void> {
    this.#o.faults.disarm();
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
  hostd: Pick<HostdClient, "boot" | "kill" | "tokens" | "health">;
  adbServer?: AdbServer;
  /** The store's `emulator-audio-proven`, written when spike EA1 passed. */
  audioProof: () => string | undefined;
  /** The store's play-services-pins.json: a versionName by device name. */
  playServicesPins: () => Record<string, unknown>;
  transcriber?: Transcriber;
  numbers: NumberBook;
  /** The seed's sign-in for a member key. */
  credentials: (member: string) => { email: string; password: string } | undefined;
  exec?: Exec;
  portCheck?: PortCheck;
  /** For tests: the gRPC controller and the console connection. */
  audioClient?: (port: number) => ControllerClient;
  consoleConnect?: (port: number) => Socket;
  sleep?: (ms: number) => Promise<void>;
}

const E01_NAMES = ["emulator-34", "emulator-35", "emulator-36"] as const satisfies readonly RigDeviceName[];

/** The contract's devices, each built when a scenario first asks for it. */
export function rigDevices(settings: DeviceSettings): DevicesApi {
  const exec = settings.exec ?? nodeExec;
  const built = new Map<RigDeviceName, { api: DeviceApi; android: AndroidDevice }>();
  const build = (name: RigDeviceName) => {
    const found = built.get(name);
    if (found) return found;
    const spec = RIG_DEVICES[name];
    const android = new AndroidDevice({
      name,
      serial: spec.serial,
      pkg: settings.pkg,
      pin: settings.pin,
      apks: settings.apks,
      exec,
      server: settings.adbServer,
      portCheck: settings.portCheck,
      sleep: settings.sleep,
    });
    // Each boot makes new tokens, so they are asked for when needed rather than kept.
    const link = new EmulatorAudioLink({
      port: spec.grpc,
      token: async () => (await settings.hostd.tokens(name)).grpc,
      adb: android.adb,
      proof: settings.audioProof,
      transcriber: settings.transcriber,
      ...(settings.audioClient ? { client: () => settings.audioClient!(spec.grpc) } : {}),
    });
    const emulatorConsole = new EmulatorConsole({
      port: spec.console,
      token: async () => (await settings.hostd.tokens(name)).console,
      adb: android.adb,
      ...(settings.consoleConnect ? { connect: settings.consoleConnect } : {}),
    });
    const api: DeviceApi = {
      name,
      reachable: () => android.reachable(),
      state: () => android.state(),
      kill: () => android.kill(),
      forceStop: () => android.forceStop(),
      forceDoze: () => android.forceDoze(),
      exitDoze: () => android.exitDoze(),
      stepDoze: () => android.stepDoze(),
      setStandbyBucket: (bucket) => android.setStandbyBucket(bucket),
      batterySaver: (on) => android.batterySaver(on),
      hibernate: (on) => android.hibernate(on),
      notificationsAllowed: (on) => android.notificationsAllowed(on),
      lock: () => android.lock(),
      unlock: () => android.unlock(),
      reboot: (options) => android.reboot(options),
      cryptoType: () => android.cryptoType(),
      install: (build) => android.install(build),
      playServicesMinimum: () => android.playServicesMinimum(),
      pushToken: () => android.pushToken(),
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
      audio: {
        proven: () => link.proven(),
        connected: () => link.connected(),
        playCode: (surface) => link.playCode(surface),
        stop: async () => link.stop(),
        hear: (args) => link.hear(args),
        transcribe: (args) => link.transcribe(args),
      },
      network: {
        shape: (shape) => emulatorConsole.shape(shape),
        outage: (ms) => emulatorConsole.outage(ms),
        wifiDrop: (ms) => emulatorConsole.wifiDrop(ms),
      },
    };
    const entry = { api, android };
    built.set(name, entry);
    return entry;
  };

  /** A booted device is at rest: unlocked when the store has a PIN, and Doze on, which every boot turns off. */
  const settle = async (name: RigDeviceName) => {
    const { android } = build(name);
    await android.waitForBoot();
    if (settings.pin() !== undefined && (await android.adb.isLocked())) await android.unlock();
    await android.enableDoze();
  };

  const devices: DevicesApi = {
    pixel: () => build("pixel").api,
    emulator: (api) => build(`emulator-${api}`).api,
    async bootEmulator(api) {
      const name = `emulator-${api}` as const;
      // Every scenario run is its own process, so an emulator another one started is found by asking adb.
      if (await build(name).android.reachable()) return;
      const booted: RigDeviceName[] = [];
      for (const other of RIG_DEVICE_NAMES) if (await build(other).android.reachable()) booted.push(other);
      if (booted.length >= MAX_BOOTED) {
        const spare = E01_NAMES.find((other) => other !== name && booted.includes(other));
        if (!spare) throw new Error(`rig: ${booted.length} emulators are booted, at max_booted ${MAX_BOOTED}, and none can be stopped`);
        await settings.hostd.kill(spare, { hard: false });
      }
      await settings.hostd.boot(name, { cold: false, wipe: false });
      await settle(name);
    },
    async shutdownEmulator(api) {
      await settings.hostd.kill(`emulator-${api}`, { hard: false });
    },
    async coldRestart(name) {
      await settings.hostd.kill(name, { hard: true });
      await settings.hostd.boot(name, { cold: true, wipe: false });
      await settle(name);
    },
    hostHealth: () => settings.hostd.health(),
    playServicesPin(name) {
      const pin = settings.playServicesPins()[name];
      return typeof pin === "string" && pin !== "" ? pin : undefined;
    },
  };
  return devices;
}

/** The app's sign-in screen as a member fills it in, its fields and button found by their English labels. */
export async function signInOnDevice(
  device: Pick<AndroidDevice, "launch" | "tapFieldLabelled" | "tapText" | "type">,
  member: string,
  credentials: { email: string; password: string } | undefined,
): Promise<boolean> {
  if (!credentials) throw new Error(`rig: no sign-in for ${member}`);
  await device.launch();
  for (const [field, value] of [
    ["Email", credentials.email],
    ["Password", credentials.password],
  ] as const) {
    if (!(await device.tapFieldLabelled(field))) return false;
    await device.type(value);
  }
  return device.tapText("Sign in");
}

/** The app's dialer: the role's digits on its keypad, then Call. */
export async function dialOnDevice(device: Pick<AndroidDevice, "launch" | "tapText">, role: string, numbers: NumberBook): Promise<void> {
  const number = numbers.number(role);
  if (!number) throw new Error(`rig: no number for ${role}`);
  await device.launch("/calls");
  if (!(await device.tapText("Dial a number"))) throw new Error("rig: the app's calls screen offered no dialer");
  for (const digit of number.replace(/^\+1/, "")) {
    if (!(await device.tapText(digit))) throw new Error("rig: the dialer's keypad is not on screen");
  }
  if (!(await device.tapText("Call"))) throw new Error("rig: the dialer offered no Call button");
}
