/**
 * Per-frame tone shares by Goertzel, the numbers every verdict is computed
 * from and the only audio evidence kept on a failure (D112).
 *
 * Each frame is Hann-windowed, and for each frequency it records how much of
 * the frame's power sits in that one tone, in dB. A share is unchanged by gain,
 * so an AGC, a quiet handset or a loud one reads the same, and a tone that only
 * leaks in from a neighbour's band stays tens of dB below a tone that is there.
 */

export const DEFAULT_FRAME_MS = 20;

/** The lowest share reported; digital silence reads this. */
export const SHARE_FLOOR_DB = -60;

/**
 * A frame quieter than this (dB relative to a full-scale sine) has no tone in
 * it worth the name. Added to every frame's power, so silence cannot divide
 * into a large share.
 */
const LEVEL_FLOOR_DB = -70;

export interface FrameTable {
  frameMs: number;
  frequencies: number[];
  /** `share[i][k]`: dB of frame k's power at `frequencies[i]`. */
  share: Float32Array[];
  /** Frame power in dB relative to a full-scale sine. */
  level: Float32Array;
}

export function analyzeFrames(
  samples: Float32Array,
  sampleRate: number,
  frequencies: readonly number[],
  frameMs = DEFAULT_FRAME_MS,
): FrameTable {
  const n = Math.round((sampleRate * frameMs) / 1000);
  if (n < 32) throw new Error(`analyzeFrames: ${frameMs} ms at ${sampleRate} Hz is too short a frame`);
  const window = new Float32Array(n);
  let windowSum = 0;
  let windowSquares = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    window[i] = w;
    windowSum += w;
    windowSquares += w * w;
  }
  const coefficients = frequencies.map((hz) => 2 * Math.cos((2 * Math.PI * hz) / sampleRate));
  const frames = Math.floor(samples.length / n);
  const share = frequencies.map(() => new Float32Array(frames));
  const level = new Float32Array(frames);
  const floor = 10 ** (LEVEL_FLOOR_DB / 10);
  const shareFloor = 10 ** (SHARE_FLOOR_DB / 10);
  const windowed = new Float32Array(n);

  for (let k = 0; k < frames; k++) {
    const start = k * n;
    let squares = 0;
    for (let i = 0; i < n; i++) {
      const x = samples[start + i]! * window[i]!;
      windowed[i] = x;
      squares += x * x;
    }
    // Both powers are in the units of a sine's squared amplitude: a full-scale
    // sine reads 1 in each, so a lone tone's share is 0 dB.
    const power = (2 * squares) / windowSquares;
    level[k] = 10 * Math.log10(power + 1e-12);
    for (let f = 0; f < frequencies.length; f++) {
      const coefficient = coefficients[f]!;
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < n; i++) {
        const s0 = windowed[i]! + coefficient * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const magnitude = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
      const tone = (4 * magnitude) / (windowSum * windowSum);
      share[f]![k] = 10 * Math.log10(Math.max(tone / (power + floor), shareFloor));
    }
  }
  return { frameMs, frequencies: [...frequencies], share, level };
}

/** Frame numbers rounded for evidence: small enough to keep, too coarse to be audio. */
export function framesForEvidence(table: FrameTable): {
  frame_ms: number;
  frequencies: number[];
  share_db: number[][];
  level_db: number[];
} {
  const round = (values: Float32Array) => Array.from(values, (v) => Math.round(v * 10) / 10);
  return {
    frame_ms: table.frameMs,
    frequencies: table.frequencies,
    share_db: table.share.map(round),
    level_db: round(table.level),
  };
}
