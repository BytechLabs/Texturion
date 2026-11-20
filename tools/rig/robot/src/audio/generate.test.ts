import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { codeSamples, writeFakeMicWavs } from "./generate.ts";
import { power } from "./simulate.ts";
import { CYCLE_MS, PATTERN, SLOT_MS, SURFACE_HZ, SURFACES } from "./surfaces.ts";
import { decodeWav } from "./wav.ts";

describe("the surface table", () => {
  it("keeps every code 200 Hz or more from every other, and off the reserved tones", () => {
    const hz = Object.values(SURFACE_HZ).toSorted((a, b) => a - b);
    for (const [i, f] of hz.slice(1).entries()) {
      expect(f - hz[i]!).toBeGreaterThanOrEqual(200);
    }
    // DTMF rows and columns, North American call progress, and the 2,600 Hz
    // trunk tone. The nearest pairs are close (1,300 to 1,336 and 1,500 to
    // 1,477), which is safe only because a keypress has no burst pattern.
    const reserved = [697, 770, 852, 941, 1209, 1336, 1477, 1633, 350, 440, 480, 620, 2600];
    for (const f of hz) for (const r of reserved) expect(Math.abs(f - r)).toBeGreaterThanOrEqual(20);
  });

  it("has a pattern whose every wrong shift lines up at most half its bursts", () => {
    const on = PATTERN.flatMap((slot, i) => (slot ? [i] : []));
    for (let shift = 1; shift < PATTERN.length; shift++) {
      const overlap = on.filter((i) => PATTERN[(i + shift) % PATTERN.length] === 1).length;
      expect(overlap).toBeLessThanOrEqual(on.length / 2);
    }
    expect(on.every((i) => PATTERN[(i + 1) % PATTERN.length] === 0)).toBe(true);
  });
});

describe(codeSamples, () => {
  it("puts a burst exactly in each on-slot and silence elsewhere", () => {
    const rate = 8000;
    const samples = codeSamples("qa-c", { sampleRate: rate, cycles: 2 });
    expect(samples).toHaveLength((2 * CYCLE_MS * rate) / 1000);
    const slot = (SLOT_MS * rate) / 1000;
    for (let i = 0; i < 2 * PATTERN.length; i++) {
      const energy = power(samples.subarray(i * slot, (i + 1) * slot));
      const active = PATTERN[i % PATTERN.length] === 1;
      expect(active ? energy > 0.025 : energy === 0, `slot ${i} energy ${energy}`).toBe(true);
    }
  });

  it("refuses a rate that cannot hold a whole slot", () => {
    expect(() => codeSamples("robot", { sampleRate: 7999, cycles: 1 })).toThrow(/does not divide/);
    expect(() => codeSamples("robot", { sampleRate: 8000, cycles: 0 })).toThrow(/positive integer/);
  });
});

describe(writeFakeMicWavs, () => {
  const dir = mkdtempSync(join(tmpdir(), "rig-fake-mic-"));

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a 48 kHz WAV of whole cycles for every surface", () => {
    const paths = writeFakeMicWavs(dir, 2);
    expect(Object.keys(paths).toSorted()).toEqual([...SURFACES].toSorted());
    for (const surface of SURFACES) {
      const pcm = decodeWav(readFileSync(paths[surface]));
      expect(pcm.sampleRate).toBe(48_000);
      expect(pcm.channels[0]!).toHaveLength((2 * CYCLE_MS * 48_000) / 1000);
    }
  });
});
