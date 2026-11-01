/**
 * The rig box's side of the Pixel lane: the USB hub that powers it, the access
 * point it joins, and the Bluetooth link that carries its audio. Each is a
 * host command; root ones go through `sudo -n`, so a box without the sudoers
 * entry fails at once instead of prompting.
 *
 * Recorded audio is held in memory, judged, and dropped (D112).
 */
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import {
  analyzeFrames,
  detectCodes,
  encodeWav,
  SURFACES,
  SURFACE_HZ,
  type Detection,
  type Surface,
  type Transcriber,
} from "@loonext/rig-robot";
import type { Exec } from "./adb.ts";

export type ExecBytes = (file: string, args: readonly string[], options?: { timeoutMs?: number }) => Promise<Buffer>;

export const nodeExecBytes: ExecBytes = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { encoding: "buffer", timeout: options?.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

/** A long-running host process, stopped by the lane. */
export interface Spawned {
  stop(): void;
}

/** Starts a process; `onExit` runs when it ends by itself or is stopped. */
export type Spawn = (file: string, args: readonly string[], onExit?: () => void) => Spawned;

export const nodeSpawn: Spawn = (file, args, onExit) => {
  const child = spawn(file, [...args], { stdio: "ignore" });
  child.on("exit", () => onExit?.());
  return { stop: () => void child.kill("SIGINT") };
};

/** The Pixel's port on the per-port-switching hub (uhubctl). */
export class UsbHub {
  readonly #location: string;
  readonly #port: number;
  readonly #exec: Exec;

  constructor(options: { location: string; port: number; exec: Exec }) {
    if (!/^[0-9-.]+$/.test(options.location)) throw new Error("usb hub: not a hub location like 1-1.4");
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 16) throw new Error("usb hub: not a port");
    this.#location = options.location;
    this.#port = options.port;
    this.#exec = options.exec;
  }

  async powerCycle(offSeconds = 5): Promise<void> {
    await this.#exec("sudo", ["-n", "uhubctl", "-l", this.#location, "-p", String(this.#port), "-a", "cycle", "-d", String(offSeconds)]);
  }
}

export interface NetworkImpairment {
  lossPercent: number;
  delayMs: number;
  jitterMs?: number;
}

/** `tc netem` on the access point's interface, which only the Pixel joins. */
export function netemArgs(iface: string, impairment: NetworkImpairment): string[] {
  const { lossPercent, delayMs, jitterMs } = impairment;
  if (!(lossPercent >= 0 && lossPercent <= 100) || !(delayMs >= 0 && delayMs <= 5_000)) throw new Error("netem: loss is 0-100 % and delay 0-5000 ms");
  return [
    "-n",
    "tc",
    "qdisc",
    "replace",
    "dev",
    iface,
    "root",
    "netem",
    "loss",
    `${lossPercent}%`,
    "delay",
    `${delayMs}ms`,
    ...(jitterMs ? [`${jitterMs}ms`] : []),
  ];
}

export class AccessPointShaper {
  readonly #iface: string;
  readonly #exec: Exec;
  readonly #sleep: (ms: number) => Promise<void>;
  #current: NetworkImpairment | null = null;

  constructor(options: { iface: string; exec: Exec; sleep?: (ms: number) => Promise<void> }) {
    if (!/^[A-Za-z0-9_.-]{1,15}$/.test(options.iface)) throw new Error("netem: not an interface name");
    this.#iface = options.iface;
    this.#exec = options.exec;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async impair(impairment: NetworkImpairment | null): Promise<void> {
    if (impairment) await this.#exec("sudo", netemArgs(this.#iface, impairment));
    else await this.#clear();
    this.#current = impairment;
  }

  /** tc fails to delete a root qdisc that is not there, so a failed delete counts only while netem is still in force. */
  async #clear(): Promise<void> {
    try {
      await this.#exec("sudo", ["-n", "tc", "qdisc", "del", "dev", this.#iface, "root"]);
    } catch (error) {
      const left = await this.#exec("tc", ["qdisc", "show", "dev", this.#iface]);
      if (/\bnetem\b/.test(left)) throw error;
    }
  }

  /** Every packet lost for that long, then back to what was in force: the phone stays associated. */
  async outage(ms: number): Promise<void> {
    const before = this.#current;
    await this.#exec("sudo", netemArgs(this.#iface, { lossPercent: 100, delayMs: 0 }));
    try {
      await this.#sleep(ms);
    } finally {
      await this.impair(before);
    }
  }
}

export interface BluetoothAudioOptions {
  /** The Pixel's Bluetooth address, from the rig's store. */
  mac: string;
  /** PipeWire node names: the hands-free unit's call source and sink, and the A2DP media source. */
  nodes: { callSource: string; callSink: string; mediaSource: string };
  /** Where writeFakeMicWavs put the surface WAVs. */
  fakeMicDir: string;
  exec: Exec;
  execBytes?: ExecBytes;
  spawn?: Spawn;
  transcriber?: Transcriber;
}

const CAPTURE_RATE = 16_000;

/** pw-record for a fixed time, as raw signed 16-bit mono on stdout. */
export function recordArgs(node: string, ms: number): string[] {
  if (!/^[A-Za-z0-9_.:-]+$/.test(node)) throw new Error("bluetooth: not a PipeWire node name");
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return [
    "--preserve-status",
    "-s",
    "INT",
    String(seconds),
    "pw-record",
    "--target",
    node,
    "--rate",
    String(CAPTURE_RATE),
    "--channels",
    "1",
    "--format",
    "s16",
    "--raw",
    "-",
  ];
}

export function pcmFromS16(bytes: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  return samples;
}

/** The rig as the Pixel's hands-free unit (PipeWire `hfp_hf`) and media sink. */
export class BluetoothAudioLink {
  readonly #o: BluetoothAudioOptions;
  readonly #execBytes: ExecBytes;
  readonly #spawn: Spawn;
  #playing: Spawned | undefined;

  constructor(options: BluetoothAudioOptions) {
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(options.mac)) throw new Error("bluetooth: not a device address");
    this.#o = options;
    this.#execBytes = options.execBytes ?? nodeExecBytes;
    this.#spawn = options.spawn ?? nodeSpawn;
  }

  async connected(): Promise<boolean> {
    const info = await this.#o.exec("bluetoothctl", ["info", this.#o.mac]).catch(() => "");
    return /^\s*Connected: yes$/m.test(info);
  }

  async playCode(surface: Surface): Promise<void> {
    if (!(SURFACES as readonly string[]).includes(surface)) throw new Error("bluetooth: not a surface");
    this.stop();
    // pw-play plays the file once; the lane plays it again until stopped, so the code lasts the call.
    let stopped = false;
    let current: Spawned | undefined;
    const loop = () => {
      if (stopped) return;
      current = this.#spawn("pw-play", ["--target", this.#o.nodes.callSink, join(this.#o.fakeMicDir, `${surface}.wav`)], loop);
    };
    loop();
    this.#playing = {
      stop: () => {
        stopped = true;
        current?.stop();
      },
    };
  }

  stop(): void {
    this.#playing?.stop();
    this.#playing = undefined;
  }

  async record(stream: "call" | "media", ms: number): Promise<Float32Array> {
    const node = stream === "call" ? this.#o.nodes.callSource : this.#o.nodes.mediaSource;
    return pcmFromS16(await this.#execBytes("timeout", recordArgs(node, ms), { timeoutMs: ms + 15_000 }));
  }

  async hear(args: { stream: "call" | "media"; ms: number; own?: Surface }): Promise<Detection> {
    const samples = await this.record(args.stream, args.ms);
    const table = analyzeFrames(samples, CAPTURE_RATE, SURFACES.map((surface) => SURFACE_HZ[surface]));
    return detectCodes(table, { own: args.own, answerOffsetMs: 0, windowStartMs: 0, windowEndMs: args.ms, announcement: false });
  }

  async transcribe(args: { stream: "call" | "media"; ms: number }): Promise<string> {
    if (!this.#o.transcriber) throw new Error("bluetooth: the rig has no transcriber configured");
    const samples = await this.record(args.stream, args.ms);
    return this.#o.transcriber.transcribe(encodeWav({ sampleRate: CAPTURE_RATE, channels: [samples] }));
  }
}
