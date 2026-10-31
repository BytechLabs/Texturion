/**
 * What a phone call does to audio, for testing the detector with no call:
 * noise, gain changes, the 300-3,400 Hz band at 8 kHz, mu-law, dropouts and
 * a second talker. Every random choice comes from a seed, so a failing case
 * replays exactly.
 */
import { linearToMulaw, mulawToLinear } from "./wav.ts";

export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function power(samples: Float32Array): number {
  let sum = 0;
  for (const x of samples) sum += x * x;
  return sum / Math.max(1, samples.length);
}

/** White noise at `snrDb` below `referencePower` (the code's power while it plays). */
export function addNoise(
  samples: Float32Array,
  snrDb: number,
  referencePower: number,
  seed: number,
): Float32Array {
  const random = rng(seed);
  const sigma = Math.sqrt(referencePower / 10 ** (snrDb / 10));
  return samples.map((x) => x + sigma * gaussian(random));
}

/** Pure noise, `seconds` long, at `levelDb` mean power (dB relative to a full-scale sine). */
export function noise(seconds: number, sampleRate: number, levelDb: number, seed: number): Float32Array {
  const random = rng(seed);
  const sigma = Math.sqrt(10 ** (levelDb / 10) / 2);
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, () => sigma * gaussian(random));
}

export function applyGain(
  samples: Float32Array,
  sampleRate: number,
  gainAt: (seconds: number) => number,
): Float32Array {
  return samples.map((x, i) => x * gainAt(i / sampleRate));
}

/** Silence first, then the samples: a code that starts some time into the call. */
export function delay(samples: Float32Array, sampleRate: number, ms: number): Float32Array {
  const out = new Float32Array(samples.length + Math.round((sampleRate * ms) / 1000));
  out.set(samples, out.length - samples.length);
  return out;
}

/** The sum of tracks, as long as the longest. */
export function mix(...tracks: Float32Array[]): Float32Array {
  const out = new Float32Array(Math.max(...tracks.map((t) => t.length)));
  for (const track of tracks) for (let i = 0; i < track.length; i++) out[i]! += track[i]!;
  return out;
}

/** Zeroes each `[startMs, endMs)` span, as a lost burst of packets would. */
export function dropouts(
  samples: Float32Array,
  sampleRate: number,
  spans: readonly [number, number][],
): Float32Array {
  const out = Float32Array.from(samples);
  for (const [startMs, endMs] of spans) {
    out.fill(0, Math.round((startMs * sampleRate) / 1000), Math.round((endMs * sampleRate) / 1000));
  }
  return out;
}

/** Windowed-sinc band-pass, Hamming window, odd length. */
export function bandPass(
  samples: Float32Array,
  sampleRate: number,
  lowHz: number,
  highHz: number,
  taps = 129,
): Float32Array {
  const m = taps - 1;
  const lo = lowHz / sampleRate;
  const hi = highHz / sampleRate;
  const h = new Float32Array(taps);
  for (let n = 0; n < taps; n++) {
    const k = n - m / 2;
    const sinc = (f: number) => (k === 0 ? 2 * f : Math.sin(2 * Math.PI * f * k) / (Math.PI * k));
    h[n] = (sinc(hi) - sinc(lo)) * (0.54 - 0.46 * Math.cos((2 * Math.PI * n) / m));
  }
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let acc = 0;
    for (let n = 0; n < taps; n++) {
      const j = i - n + m / 2;
      if (j >= 0 && j < samples.length) acc += h[n]! * samples[j]!;
    }
    out[i] = acc;
  }
  return out;
}

/** Every `factor`-th sample; band-limit first. */
export function decimate(samples: Float32Array, factor: number): Float32Array {
  return Float32Array.from({ length: Math.floor(samples.length / factor) }, (_, i) => samples[i * factor]!);
}

export function mulawRoundTrip(samples: Float32Array): Float32Array {
  return samples.map((x) => mulawToLinear(linearToMulaw(Math.max(-1, Math.min(1, x)) * 32767)) / 32768);
}

/** A narrowband phone path from 16 kHz: 300-3,400 Hz, down to 8 kHz, through mu-law. */
export function phoneLine(samples16k: Float32Array): Float32Array {
  return mulawRoundTrip(decimate(bandPass(samples16k, 16_000, 300, 3_400), 2));
}
