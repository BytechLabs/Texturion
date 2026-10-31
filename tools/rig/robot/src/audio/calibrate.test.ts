import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { calibrate, loadMargins, saveMargins } from "./calibrate.ts";
import { detectCodes } from "./detect.ts";
import { analyzeFrames } from "./frames.ts";
import { codeSamples } from "./generate.ts";
import { addNoise, delay, phoneLine, power } from "./simulate.ts";
import { SURFACES, SURFACE_HZ } from "./surfaces.ts";

const BANDS = SURFACES.map((s) => SURFACE_HZ[s]);

function line(snrDb: number, seed: number) {
  const code = delay(codeSamples("qa-w-owner", { sampleRate: 16_000, cycles: 8 }), 16_000, 400);
  const reference = power(codeSamples("qa-w-owner", { sampleRate: 16_000, cycles: 1 }).subarray(0, 2560));
  return analyzeFrames(phoneLine(addNoise(code, snrDb, reference, seed)), 8_000, BANDS);
}

describe("calibrate", () => {
  it("sets a margin between the path's noise and the code's contrast", () => {
    const result = calibrate(line(20, 1), { surface: "qa-w-owner", own: "robot" });
    expect(result.ok).toBe(true);
    expect(result.marginDb).toBeGreaterThan(result.noiseDb);
    expect(result.marginDb).toBeLessThan(result.signalDb);
  });

  it("gives a margin that still hears a noisier call and still ignores noise", () => {
    const { marginDb } = calibrate(line(20, 1), { surface: "qa-w-owner" });
    const margins = { "qa-w-owner": marginDb };
    expect(detectCodes(line(5, 2), { margins }).answered).toBe("qa-w-owner");
    const quiet = analyzeFrames(addNoise(new Float32Array(8_000 * 14), 0, 1e-4, 3), 8_000, BANDS);
    expect(detectCodes(quiet, { margins }).verdict).toBe("silent");
  });

  it("fails a calibration call that carried no code", () => {
    const silent = analyzeFrames(addNoise(new Float32Array(8_000 * 14), 0, 1e-4, 4), 8_000, BANDS);
    const result = calibrate(silent, { surface: "qa-w-owner" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not survive|reads as/);
  });

  it("fails a recording too short to hold three cycles", () => {
    const short = analyzeFrames(codeSamples("pixel", { sampleRate: 8_000, cycles: 3 }), 8_000, BANDS);
    expect(calibrate(short, { surface: "pixel" })).toMatchObject({ ok: false });
  });
});

describe("margins on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "rig-margins-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps the old margin when a calibration fails", () => {
    const path = join(dir, "margins.json");
    const next = saveMargins(path, { pixel: 9 }, [
      { surface: "pixel", signalDb: 1, noiseDb: 0, marginDb: 1, ok: false },
      { surface: "qa-c", signalDb: 30, noiseDb: 2, marginDb: 12, ok: true },
    ]);
    expect(next).toEqual({ pixel: 9, "qa-c": 12 });
    expect(loadMargins(path)).toEqual(next);
  });

  it("reads a missing file as no margins, and refuses a malformed one", () => {
    expect(loadMargins(join(dir, "absent.json"))).toEqual({});
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ trumpet: 3 }));
    expect(() => loadMargins(bad)).toThrow(/not a surface/);
  });
});
