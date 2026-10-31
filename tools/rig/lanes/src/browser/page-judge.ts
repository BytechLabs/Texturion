/**
 * The test-only in-page judge, installed before any page script runs.
 *
 * It wraps RTCPeerConnection so every remote audio track is captured. Each
 * track is first attached to a muted audio element, because without one
 * Chrome hands Web Audio silence for a remote WebRTC stream (crbug 933677).
 * The page then only records: 16 kHz samples of what it hears, getStats
 * audio level, energy and concealed samples every half second, and named
 * marks. The judging itself happens in Node with the robot's detector, so
 * there is one implementation of what "heard" means.
 *
 * This function is serialised into the page, so it may use nothing from its
 * module: every value it needs arrives in `config`.
 */

export interface PageJudgeConfig {
  captureRate: number;
  maxSeconds: number;
  statsIntervalMs: number;
}

export interface StatSample {
  at: number;
  peer: number;
  kind: "inbound" | "source";
  audioLevel?: number;
  totalAudioEnergy?: number;
  totalSamplesDuration?: number;
  concealedSamples?: number;
  totalSamplesReceived?: number;
  packetsLost?: number;
  jitter?: number;
}

export interface PageCapture {
  sampleRate: number;
  /** Epoch ms of the first captured sample, or null if no remote audio arrived. */
  startedAt: number | null;
  /** Little-endian 16-bit PCM, base64. */
  pcm_b64: string;
  marks: { name: string; at: number }[];
  stats: StatSample[];
  remoteStreams: number;
}

export interface RigJudgeHandle {
  take(): PageCapture;
  mark(name: string): void;
}

export function installPageJudge(config: PageJudgeConfig): void {
  const scope = window as unknown as { __rigJudge?: RigJudgeHandle; RTCPeerConnection: typeof RTCPeerConnection };
  if (scope.__rigJudge || typeof scope.RTCPeerConnection !== "function") return;

  const Native = scope.RTCPeerConnection;
  const peers: RTCPeerConnection[] = [];
  const seen = new Set<string>();
  const holders: HTMLAudioElement[] = [];
  const marks: { name: string; at: number }[] = [];
  const stats: StatSample[] = [];
  const pcm = new Int16Array(config.captureRate * config.maxSeconds);
  let written = 0;
  let startedAt: number | null = null;
  let context: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;

  const write = (value: number) => {
    if (written >= pcm.length) return;
    const clipped = Math.max(-1, Math.min(1, value));
    pcm[written++] = Math.round(clipped * 32767);
  };

  const attach = (stream: MediaStream) => {
    if (seen.has(stream.id)) return;
    seen.add(stream.id);
    const holder = new Audio();
    holder.muted = true;
    holder.autoplay = true;
    holder.srcObject = stream;
    void holder.play().catch(() => undefined);
    holders.push(holder);

    if (!context) {
      context = new AudioContext();
      const ctx = context;
      processor = ctx.createScriptProcessor(4096, 1, 1);
      const step = ctx.sampleRate / config.captureRate;
      let phase = 0;
      let sum = 0;
      let count = 0;
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        if (startedAt === null) startedAt = Date.now() - (input.length / ctx.sampleRate) * 1000;
        for (let i = 0; i < input.length; i++) {
          sum += input[i]!;
          count++;
          phase += 1;
          if (phase >= step) {
            phase -= step;
            write(sum / count);
            sum = 0;
            count = 0;
          }
        }
      };
      processor.connect(ctx.destination);
    }
    void context.resume();
    context.createMediaStreamSource(stream).connect(processor!);
  };

  class RigPeerConnection extends Native {
    constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
      super(...args);
      peers.push(this);
      this.addEventListener("track", (event) => {
        const track = (event as RTCTrackEvent).track;
        if (track.kind !== "audio") return;
        attach((event as RTCTrackEvent).streams[0] ?? new MediaStream([track]));
      });
    }
  }
  scope.RTCPeerConnection = RigPeerConnection;

  const sample = async () => {
    for (let index = 0; index < peers.length; index++) {
      const peer = peers[index]!;
      if (peer.connectionState === "closed") continue;
      let report: RTCStatsReport;
      try {
        report = await peer.getStats();
      } catch {
        continue;
      }
      report.forEach((entry: Record<string, unknown>) => {
        const n = (key: string) => (typeof entry[key] === "number" ? (entry[key] as number) : undefined);
        if (entry.type === "inbound-rtp" && entry.kind === "audio") {
          stats.push({
            at: Date.now(),
            peer: index,
            kind: "inbound",
            audioLevel: n("audioLevel"),
            totalAudioEnergy: n("totalAudioEnergy"),
            totalSamplesDuration: n("totalSamplesDuration"),
            concealedSamples: n("concealedSamples"),
            totalSamplesReceived: n("totalSamplesReceived"),
            packetsLost: n("packetsLost"),
            jitter: n("jitter"),
          });
        } else if (entry.type === "media-source" && entry.kind === "audio") {
          stats.push({
            at: Date.now(),
            peer: index,
            kind: "source",
            audioLevel: n("audioLevel"),
            totalAudioEnergy: n("totalAudioEnergy"),
            totalSamplesDuration: n("totalSamplesDuration"),
          });
        }
      });
    }
    if (stats.length > 2_000) stats.splice(0, stats.length - 2_000);
  };
  setInterval(() => void sample(), config.statsIntervalMs);

  scope.__rigJudge = {
    mark(name: string) {
      marks.push({ name, at: Date.now() });
    },
    take(): PageCapture {
      const bytes = new Uint8Array(pcm.buffer, 0, written * 2);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return {
        sampleRate: config.captureRate,
        startedAt,
        pcm_b64: btoa(binary),
        marks: [...marks],
        stats: [...stats],
        remoteStreams: seen.size,
      };
    },
  };
}
