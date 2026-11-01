/**
 * An emulator's audio, through its gRPC EmulatorController: `injectAudio`
 * plays into the guest's microphone, and `streamAudio` returns what its one
 * output device plays. The device lane's codes are injected and heard here,
 * at 48 kHz, signed 16-bit mono, and judged with the robot's detector.
 *
 * Neither call has run on this host yet. Until spike EA1 has passed and the
 * store holds `emulator-audio-proven`, hear, playCode and transcribe refuse
 * with `emulator-audio-unproven`, which a runner reports as infra and never
 * as a pass. On Windows the emulator forwards injected audio only to a
 * microphone the guest has already opened (EA1's timing note), so injection
 * waits for `dumpsys audio` to list an active recording.
 *
 * Audio is held in memory, judged, and dropped (D112).
 */
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import {
  analyzeFrames,
  bandPass,
  codeSamples,
  decimate,
  detectCodes,
  encodeWav,
  isSurface,
  SURFACES,
  SURFACE_HZ,
  type Detection,
  type Surface,
  type Transcriber,
} from "@loonext/rig-robot";
import type { Adb } from "./adb.ts";

export const AUDIO_UNPROVEN = "emulator-audio-unproven";
export const AUDIO_RATE = 48_000;
const PACKET_MS = 20;
const PACKET_SAMPLES = (AUDIO_RATE * PACKET_MS) / 1000;
const WHISPER_RATE = 16_000;

export const PROTO_PATH = fileURLToPath(new URL("../../proto/emulator_controller.proto", import.meta.url));

export interface AudioFormat {
  samplingRate: number;
  channels: "Mono" | "Stereo";
  format: "AUD_FMT_U8" | "AUD_FMT_S16";
  mode?: "MODE_UNSPECIFIED" | "MODE_REAL_TIME";
}

export interface AudioPacket {
  format?: AudioFormat | null;
  /** Unix epoch in microseconds. */
  timestamp: number;
  audio: Buffer;
}

/** The three EmulatorController calls the rig makes. */
export interface ControllerClient {
  getStatus(request: object, metadata: grpc.Metadata, options: grpc.CallOptions, callback: (error: grpc.ServiceError | null) => void): grpc.ClientUnaryCall;
  streamAudio(request: AudioFormat, metadata: grpc.Metadata): grpc.ClientReadableStream<AudioPacket>;
  injectAudio(metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null) => void): grpc.ClientWritableStream<AudioPacket>;
  close(): void;
}

let definition: grpc.GrpcObject | undefined;

/** The vendored proto's EmulatorController service, loaded once. */
export function emulatorController(): grpc.ServiceClientConstructor {
  definition ??= grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: Number, enums: String, defaults: true }));
  const control = (definition.android as grpc.GrpcObject).emulation as grpc.GrpcObject;
  return (control.control as grpc.GrpcObject).EmulatorController as grpc.ServiceClientConstructor;
}

/** What spike EA1 wrote when it passed: the day, and the emulator flags it passed with. */
export interface AudioProof {
  date: string;
  flags: string[];
}

/** The store's `emulator-audio-proven`, or undefined when it is absent or not a proof. */
export function readAudioProof(text: string | undefined): AudioProof | undefined {
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const { date, flags } = (value ?? {}) as { date?: unknown; flags?: unknown };
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(date) || !Number.isFinite(Date.parse(date))) return undefined;
  if (!Array.isArray(flags) || !flags.every((flag) => typeof flag === "string" && /^-[a-z][a-z0-9-]*$/.test(flag))) return undefined;
  return { date, flags };
}

/**
 * Whether `dumpsys audio`'s RecordActivityMonitor lists a recording that is
 * active and not silenced. Each recording is an unindented "riid N; active? B"
 * line and then its indented "session:" line (an API 36 guest, EA1).
 */
export function recordingActive(dump: string): boolean {
  const lines = dump.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.includes("RecordActivityMonitor dump time"));
  if (start === -1) return false;
  let active = true;
  for (const line of lines.slice(start + 1)) {
    const riid = /^riid\s+\d+;\s*active\?\s*(true|false)\b/.exec(line);
    if (riid) {
      active = riid[1] === "true";
      continue;
    }
    if (line.trim() !== "" && !/^\s/.test(line)) break;
    if (active && /^\s*session:\s*\d+\b/.test(line) && !/silenced:\s*true/.test(line)) return true;
  }
  return false;
}

export function s16FromPcm(samples: Float32Array): Buffer {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((x, i) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), i * 2));
  return bytes;
}

export function pcmFromS16(bytes: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  return samples;
}

/**
 * Packets laid on one timeline by their timestamps, a gap filled with
 * silence: the stream stalls while the guest plays nothing.
 */
export function assemble(packets: readonly { timestamp: number; samples: Float32Array }[], rate: number, length: number): Float32Array {
  const out = new Float32Array(length);
  const origin = packets[0]?.timestamp ?? 0;
  let written = 0;
  for (const packet of packets) {
    const at = Math.round(((packet.timestamp - origin) / 1e6) * rate);
    // A packet early by less than its own length is jitter, not overlap.
    if (at > written + PACKET_SAMPLES) written = at;
    out.set(packet.samples.subarray(0, Math.max(0, length - written)), Math.min(written, length));
    written += packet.samples.length;
    if (written >= length) break;
  }
  return out;
}

export interface EmulatorAudioOptions {
  /** The emulator's gRPC port, tunnelled to the VM's loopback. */
  port: number;
  /** The gRPC token, from hostd. */
  token: () => string | Promise<string>;
  /** For `dumpsys audio`. */
  adb: Pick<Adb, "shell">;
  /** The store's `emulator-audio-proven`. */
  proof: () => string | undefined;
  transcriber?: Transcriber;
  client?: () => ControllerClient;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the guest's microphone before giving up on a playCode. */
  micWaitMs?: number;
}

interface Playing {
  stopped: boolean;
  stream?: grpc.ClientWritableStream<AudioPacket>;
}

export class EmulatorAudioLink {
  readonly port: number;
  /** Why the last injection ended early, if it did; kept for the run's evidence. */
  lastError: string | undefined;
  readonly #o: EmulatorAudioOptions;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  #client: ControllerClient | undefined;
  #playing: Playing | undefined;

  constructor(options: EmulatorAudioOptions) {
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) throw new Error("emulator audio: not a port");
    this.port = options.port;
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async proven(): Promise<boolean> {
    return readAudioProof(this.#o.proof()) !== undefined;
  }

  /** The controller answers getStatus. */
  async connected(): Promise<boolean> {
    try {
      const metadata = await this.#metadata();
      return await new Promise((resolve) => {
        this.#controller().getStatus({}, metadata, { deadline: Date.now() + 5_000 }, (error) => resolve(error === null));
      });
    } catch {
      return false;
    }
  }

  /**
   * Plays the surface's code into the guest's microphone, looped in real
   * time until stop(), once the guest has opened its microphone. Resolves
   * once the playing has started waiting for it.
   */
  async playCode(surface: Surface): Promise<void> {
    if (!isSurface(surface)) throw new Error("emulator audio: not a surface");
    this.#gate();
    this.stop();
    const metadata = await this.#metadata();
    const playing: Playing = { stopped: false };
    this.#playing = playing;
    this.lastError = undefined;
    void this.#inject(surface, metadata, playing).catch((error: unknown) => {
      if (!playing.stopped) this.lastError = error instanceof Error ? error.message : String(error);
    });
  }

  stop(): void {
    const playing = this.#playing;
    this.#playing = undefined;
    if (!playing) return;
    playing.stopped = true;
    playing.stream?.end();
  }

  /** What the guest's output plays for that long, judged here. `call` and `media` are the one output device. */
  async hear(args: { stream: "call" | "media"; ms: number; own?: Surface }): Promise<Detection> {
    this.#gate();
    const { samples, rate } = await this.#record(args.ms);
    const table = analyzeFrames(samples, rate, SURFACES.map((surface) => SURFACE_HZ[surface]));
    return detectCodes(table, { own: args.own, answerOffsetMs: 0, windowStartMs: 0, windowEndMs: args.ms, announcement: false });
  }

  /** The same stream, at whisper's 16 kHz, through the transcriber; no audio is kept. */
  async transcribe(args: { stream: "call" | "media"; ms: number }): Promise<string> {
    this.#gate();
    if (!this.#o.transcriber) throw new Error("emulator audio: the rig has no transcriber configured");
    const { samples, rate } = await this.#record(args.ms);
    if (rate % WHISPER_RATE !== 0) throw new Error(`emulator audio: ${rate} Hz does not decimate to ${WHISPER_RATE} Hz`);
    const factor = rate / WHISPER_RATE;
    const narrowed = factor === 1 ? samples : decimate(bandPass(samples, rate, 80, 7_600), factor);
    return this.#o.transcriber.transcribe(encodeWav({ sampleRate: WHISPER_RATE, channels: [narrowed] }));
  }

  close(): void {
    this.stop();
    this.#client?.close();
    this.#client = undefined;
  }

  #gate(): void {
    if (readAudioProof(this.#o.proof()) === undefined) throw new Error(AUDIO_UNPROVEN);
  }

  #controller(): ControllerClient {
    if (this.#client) return this.#client;
    const make = this.#o.client ?? (() => new (emulatorController())(`127.0.0.1:${this.port}`, grpc.credentials.createInsecure()) as unknown as ControllerClient);
    this.#client = make();
    return this.#client;
  }

  async #metadata(): Promise<grpc.Metadata> {
    const token = await this.#o.token();
    if (!/^[A-Za-z0-9+/=._-]{1,512}$/.test(token)) throw new Error("emulator audio: the gRPC token is not a token");
    const metadata = new grpc.Metadata();
    metadata.set("authorization", `Bearer ${token}`);
    return metadata;
  }

  async #inject(surface: Surface, metadata: grpc.Metadata, playing: Playing): Promise<void> {
    const waitUntil = this.#now() + (this.#o.micWaitMs ?? 120_000);
    while (!playing.stopped && !recordingActive(await this.#o.adb.shell("dumpsys", "audio"))) {
      if (this.#now() >= waitUntil) throw new Error("emulator audio: the guest never opened its microphone");
      await this.#sleep(250);
    }
    if (playing.stopped) return;
    const code = s16FromPcm(codeSamples(surface, { sampleRate: AUDIO_RATE, cycles: 1 }));
    const packetBytes = PACKET_SAMPLES * 2;
    const stream = this.#controller().injectAudio(metadata, (error) => {
      if (error && error.code !== grpc.status.CANCELLED && !playing.stopped) this.lastError = `injectAudio: ${error.details || error.message}`;
    });
    playing.stream = stream;
    const format: AudioFormat = { samplingRate: AUDIO_RATE, channels: "Mono", format: "AUD_FMT_S16", mode: "MODE_REAL_TIME" };
    // Real-time mode overwrites what is queued, so each packet goes out on the clock, not as fast as it can.
    const started = this.#now();
    for (let packet = 0; !playing.stopped; packet++) {
      const offset = (packet * packetBytes) % code.length;
      const audio = code.subarray(offset, offset + packetBytes);
      const sent = stream.write({ ...(packet === 0 ? { format } : {}), timestamp: Math.round(this.#now() * 1000), audio });
      if (!sent) await new Promise((resolve) => stream.once("drain", resolve));
      await this.#sleep(Math.max(0, started + (packet + 1) * PACKET_MS - this.#now()));
    }
  }

  async #record(ms: number): Promise<{ samples: Float32Array; rate: number }> {
    if (!Number.isInteger(ms) || ms <= 0 || ms > 120_000) throw new Error("emulator audio: a recording is 1-120000 ms");
    const metadata = await this.#metadata();
    const stream = this.#controller().streamAudio({ samplingRate: AUDIO_RATE, channels: "Mono", format: "AUD_FMT_S16" }, metadata);
    const packets: { timestamp: number; samples: Float32Array }[] = [];
    let rate = AUDIO_RATE;
    let have = 0;
    const needed = () => Math.round((ms * rate) / 1000);
    await new Promise<void>((resolve, reject) => {
      // The stream blocks while the guest is silent, so the wall clock ends it too.
      const timer = setTimeout(finish, ms + 5_000);
      function finish(error?: Error) {
        clearTimeout(timer);
        stream.removeAllListeners("data");
        stream.cancel();
        if (error) reject(error);
        else resolve();
      }
      stream.on("data", (packet: AudioPacket) => {
        if (packet.format?.samplingRate) rate = Number(packet.format.samplingRate);
        const samples = pcmFromS16(Buffer.from(packet.audio));
        packets.push({ timestamp: Number(packet.timestamp), samples });
        have += samples.length;
        if (have >= needed()) finish();
      });
      stream.on("error", (error: grpc.ServiceError) => {
        if (error.code === grpc.status.CANCELLED) return;
        finish(new Error(`streamAudio: ${error.details || error.message}`));
      });
      stream.on("end", () => finish());
    });
    return { samples: assemble(packets, rate, needed()), rate };
  }
}
