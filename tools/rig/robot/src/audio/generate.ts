import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CYCLE_MS, PATTERN, SLOT_MS, SURFACES, SURFACE_HZ, type Surface } from "./surfaces.ts";
import { encodeWav } from "./wav.ts";

export interface CodeOptions {
  sampleRate: number;
  /** Whole cycles, so a player that loops the file keeps the pattern unbroken. */
  cycles: number;
  /** Peak amplitude of each burst, full scale 1. */
  amplitude?: number;
  /** Raised-cosine ramp at each burst edge; a hard edge splatters into the neighbours' bands. */
  rampMs?: number;
}

export function codeSamples(surface: Surface, options: CodeOptions): Float32Array {
  const { sampleRate, cycles } = options;
  const amplitude = options.amplitude ?? 0.25;
  const rampMs = options.rampMs ?? 5;
  if (!Number.isInteger(cycles) || cycles < 1) throw new Error("codeSamples: cycles must be a positive integer");
  const slotSamples = (sampleRate * SLOT_MS) / 1000;
  if (!Number.isInteger(slotSamples)) {
    throw new Error(`codeSamples: ${sampleRate} Hz does not divide a ${SLOT_MS} ms slot`);
  }
  const omega = (2 * Math.PI * SURFACE_HZ[surface]) / sampleRate;
  const ramp = Math.max(1, Math.round((sampleRate * rampMs) / 1000));
  const out = new Float32Array(slotSamples * PATTERN.length * cycles);
  for (let cycle = 0; cycle < cycles; cycle++) {
    PATTERN.forEach((on, slot) => {
      if (!on) return;
      const start = (cycle * PATTERN.length + slot) * slotSamples;
      for (let n = 0; n < slotSamples; n++) {
        const edge = Math.min(n, slotSamples - 1 - n);
        const envelope = edge < ramp ? 0.5 - 0.5 * Math.cos((Math.PI * edge) / ramp) : 1;
        out[start + n] = amplitude * envelope * Math.sin(omega * (start + n));
      }
    });
  }
  return out;
}

/** One surface's code as a 16-bit mono WAV. */
export function codeWav(surface: Surface, options: CodeOptions): Uint8Array<ArrayBuffer> {
  return encodeWav({
    sampleRate: options.sampleRate,
    channels: [codeSamples(surface, options)],
  });
}

/**
 * The browsers' fake microphones: `<dir>/<surface>.wav` for every surface.
 * Chrome loops the file, so it holds whole cycles; 48 kHz is Chrome's capture
 * rate, so nothing is resampled before Opus.
 */
export function writeFakeMicWavs(dir: string, cycles = 8): Record<Surface, string> {
  mkdirSync(dir, { recursive: true });
  const paths = {} as Record<Surface, string>;
  for (const surface of SURFACES) {
    const path = join(dir, `${surface}.wav`);
    writeFileSync(path, codeWav(surface, { sampleRate: 48_000, cycles }));
    paths[surface] = path;
  }
  return paths;
}

export function codeDurationMs(cycles: number): number {
  return cycles * CYCLE_MS;
}
