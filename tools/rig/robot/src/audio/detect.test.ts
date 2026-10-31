import { describe, expect, it } from "vitest";
import { detectInSamples, findAnnouncement, type DetectOptions } from "./detect.ts";
import { analyzeFrames } from "./frames.ts";
import { codeSamples } from "./generate.ts";
import {
  addNoise,
  applyGain,
  bandPass,
  delay,
  dropouts,
  mix,
  noise,
  phoneLine,
  power,
} from "./simulate.ts";
import { BURSTS_PER_CYCLE, CYCLE_MS, SURFACES, SURFACE_HZ, type Surface } from "./surfaces.ts";

const RATE = 8_000;
/** Mean power of a playing burst, the reference for every SNR below. */
const BURST_POWER = power(codeSamples("robot", { sampleRate: RATE, cycles: 1 }).subarray(0, 1280));

/** A far end that starts its code `startMs` after answer and plays 15 s of it. */
function call(surface: Surface, { rate = RATE, startMs = 300, amplitude = 0.25 } = {}): Float32Array {
  return delay(codeSamples(surface, { sampleRate: rate, cycles: 8, amplitude }), rate, startMs);
}

function detect(samples: Float32Array, options: DetectOptions = {}, rate = RATE) {
  return detectInSamples(samples, rate, options).detection;
}

describe("a clean line", () => {
  it.each(SURFACES)("hears %s, and only %s", (surface) => {
    const detection = detect(call(surface));
    expect(detection.verdict).toBe("heard");
    expect(detection.answered).toBe(surface);
    expect(detection.heard).toEqual([surface]);
    const score = detection.scores[surface]!;
    expect(score.cycles).toBeGreaterThanOrEqual(4);
    expect(score.burstsMissing).toBe(0);
  });

  it("finds the phase of a code that starts mid-cycle", () => {
    const detection = detect(call("qa-c", { startMs: 1_234 }));
    expect(detection.answered).toBe("qa-c");
    const phase = (detection.scores["qa-c"]!.phaseMs - 1_234) % CYCLE_MS;
    expect(Math.min(phase, CYCLE_MS - phase)).toBeLessThanOrEqual(40);
  });

  it("works at the browsers' 48 kHz as well as the phone's 8 kHz", () => {
    const detection = detect(call("pixel", { rate: 48_000 }), {}, 48_000);
    expect(detection.answered).toBe("pixel");
  });
});

describe("silence and noise", () => {
  it("calls digital silence silent", () => {
    const detection = detect(new Float32Array(RATE * 14));
    expect(detection.verdict).toBe("silent");
    expect(detection.answered).toBeNull();
    expect(detection.window.silentFrames).toBe(500);
  });

  it("never hears a code in noise alone, over many seeds", () => {
    const verdicts = Array.from({ length: 24 }, (_, seed) =>
      detect(noise(14, RATE, -20, 1_000 + seed)).verdict,
    );
    expect(verdicts.filter((v) => v === "heard")).toEqual([]);
    expect(verdicts.filter((v) => v === "silent").length).toBeGreaterThanOrEqual(20);
  });

  it.each([10, 0, -5])("hears through white noise at %d dB SNR", (snr) => {
    const detection = detect(addNoise(call("qa-w-owner"), snr, BURST_POWER, 7));
    expect(detection.verdict).toBe("heard");
    expect(detection.heard).toEqual(["qa-w-owner"]);
  });

  it("does not claim a code buried 20 dB under noise", () => {
    const detection = detect(addNoise(call("qa-w-owner"), -20, BURST_POWER, 9));
    expect(detection.verdict).not.toBe("heard");
  });

  it("does not read a loud code's shadow as bursts in the other bands", () => {
    // While a code plays, every other band's share of the frame dips, which at
    // the wrong phase looks like a pattern. Lightly noisy lines show it most.
    for (const seed of [1, 2, 3, 4]) {
      const line = phoneLine(addNoise(call("qa-w-owner", { rate: 16_000 }), 20, BURST_POWER, seed));
      const detection = detect(line);
      expect(detection.heard).toEqual(["qa-w-owner"]);
      for (const surface of SURFACES.filter((s) => s !== "qa-w-owner")) {
        expect(detection.scores[surface]!.cycles, `${surface}, seed ${seed}`).toBe(0);
      }
    }
  });

  it("ignores a steady tone at a surface's frequency", () => {
    const steady = Float32Array.from({ length: RATE * 14 }, (_, i) => 0.25 * Math.sin((2 * Math.PI * 1_500 * i) / RATE));
    expect(detect(steady).verdict).toBe("silent");
  });

  it("does not hear a code that holds too small a share of the line, however clean its pattern", () => {
    // A loud hum outside every surface band, and the code 30 dB under it: the
    // bursts stand far above their gaps, but hold only -30 dB of each frame.
    const hum = Float32Array.from({ length: RATE * 16 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE));
    const whisper = mix(hum, call("robot", { amplitude: 0.5 * 10 ** (-30 / 20) }));
    const detection = detect(whisper);
    expect(detection.scores.robot!.cycleScores.some((cycle) => cycle.contrastDb >= 6 && cycle.correlation >= 0.5)).toBe(true);
    expect(detection.verdict).not.toBe("heard");
  });
});

describe("gain", () => {
  it("hears a code that fades by 30 dB across the call", () => {
    const fading = applyGain(call("emulator"), RATE, (t) => 10 ** ((-30 * t) / 15 / 20));
    expect(detect(fading).answered).toBe("emulator");
  });

  it("hears through an AGC that steps 20 dB down and back mid-cycle", () => {
    const stepped = applyGain(call("qa-a-dispatcher"), RATE, (t) => (t > 4.1 && t < 8.7 ? 0.1 : 1));
    const detection = detect(stepped);
    expect(detection.answered).toBe("qa-a-dispatcher");
    expect(detection.scores["qa-a-dispatcher"]!.cycles).toBeGreaterThanOrEqual(4);
  });

  it("hears a quiet handset 40 dB below full scale", () => {
    expect(detect(call("pixel", { amplitude: 0.0025 })).answered).toBe("pixel");
  });
});

describe("a narrowband phone line: 300-3,400 Hz at 8 kHz through mu-law", () => {
  it.each(SURFACES)("still names %s", (surface) => {
    const line = phoneLine(call(surface, { rate: 16_000 }));
    const detection = detect(line);
    expect(detection.heard).toEqual([surface]);
  });

  it("survives the line, noise and a fade together", () => {
    const clean = call("qa-w-technician", { rate: 16_000 });
    const noisy = addNoise(clean, 3, BURST_POWER, 11);
    const faded = applyGain(noisy, 16_000, (t) => 1 - t / 30);
    expect(detect(phoneLine(faded)).answered).toBe("qa-w-technician");
  });
});

describe("dropouts", () => {
  it("still hears a code with lost bursts, and counts them", () => {
    // The code starts at 300 ms, so cycle k's bursts start at 300 + 1,920k plus
    // 0, 320, 800 and 1,440 ms. Each hole swallows one whole burst.
    const holed = dropouts(call("qa-c"), RATE, [
      [2_200, 2_400],
      [4_920, 5_120],
      [9_400, 9_600],
    ]);
    const detection = detect(holed);
    expect(detection.answered).toBe("qa-c");
    const score = detection.scores["qa-c"]!;
    expect(score.burstsMissing).toBe(3);
    expect(score.burstsExpected).toBe(score.cyclesInWindow * BURSTS_PER_CYCLE);
    expect(detection.window.silentFrames).toBeGreaterThan(0);
  });

  it("calls a line that drops for most of the window faint, not heard", () => {
    const holed = dropouts(call("qa-c"), RATE, [[4_000, 15_000]]);
    expect(detect(holed).verdict).toBe("faint");
  });
});

describe("two surfaces at once", () => {
  it("names the far end and reports the listener's own code as echo", () => {
    const farEnd = call("qa-w-owner");
    const echo = call("robot", { startMs: 420, amplitude: 0.025 });
    const detection = detect(mix(farEnd, echo), { own: "robot" });
    expect(detection.answered).toBe("qa-w-owner");
    expect(detection.heard).toEqual(["qa-w-owner"]);
    expect(detection.echo).toMatchObject({ surface: "robot" });
    expect(detection.echo!.cycles).toBeGreaterThanOrEqual(3);
  });

  it("reports no echo when the listener's code does not come back", () => {
    const detection = detect(call("qa-w-owner"), { own: "robot" });
    expect(detection.echo).toBeNull();
  });

  it("hears both of two answering surfaces, so a race with two winners is visible", () => {
    const both = mix(
      call("pixel", { rate: 16_000, startMs: 200 }),
      call("qa-a-dispatcher", { rate: 16_000, startMs: 900, amplitude: 0.12 }),
    );
    const detection = detect(phoneLine(both));
    expect(detection.heard.sort()).toEqual(["pixel", "qa-a-dispatcher"]);
  });

  it("separates the two closest frequencies, 200 Hz apart, at a 20 dB level difference", () => {
    const both = mix(call("robot"), call("qa-w-owner", { startMs: 700, amplitude: 0.025 }));
    const detection = detect(both);
    expect(detection.heard.sort()).toEqual(["qa-w-owner", "robot"]);
  });
});

/**
 * Speech-like sound with no code in it: phone-band noise in syllables of
 * 200 ms, 50 ms apart, `seconds` long, starting `startMs` into the call.
 */
function announcement(seconds: number, { startMs = 200, rate = RATE, seed = 5 } = {}): Float32Array {
  const voiced = bandPass(noise(seconds, rate, -12, seed), rate, 300, 3_400);
  const syllable = Math.round(0.25 * rate);
  const shaped = voiced.map((x, i) => ((i % syllable) < 0.8 * syllable ? x : 0));
  return delay(shaped, rate, startMs);
}

describe("Telnyx's automated-call announcement", () => {
  it("finds a spoken opening, and none in a call that opens with its code", () => {
    const opening = analyzeFrames(mix(announcement(4), new Float32Array(RATE * 6)), RATE, SURFACES.map((s) => SURFACE_HZ[s]));
    const found = findAnnouncement(opening, 0);
    expect(found).toBeDefined();
    expect(found!.startMs).toBeLessThanOrEqual(300);
    expect(found!.endMs).toBeGreaterThanOrEqual(4_000);
    expect(found!.endMs).toBeLessThanOrEqual(4_400);
    const coded = analyzeFrames(call("qa-w-owner"), RATE, SURFACES.map((s) => SURFACE_HZ[s]));
    expect(findAnnouncement(coded, 0)).toBeUndefined();
    // Line noise or a hum that never stops is not an announcement.
    const hiss = analyzeFrames(noise(14, RATE, -20, 3), RATE, SURFACES.map((s) => SURFACE_HZ[s]));
    expect(findAnnouncement(hiss, 0)).toBeUndefined();
  });

  it("starts the window after the announcement, so a code that follows it is heard", () => {
    // Six seconds of announcement, then the far end's code: the usual 2-12 s
    // window would hold the announcement and under three cycles of code.
    const recording = mix(announcement(6), call("qa-w-owner", { startMs: 6_400 }));
    const waited = detect(recording);
    expect(waited.window.announcementMs).toBeGreaterThanOrEqual(5_800);
    expect(waited.window.startMs).toBeGreaterThanOrEqual(6_000);
    expect(waited.window.endMs - waited.window.startMs).toBe(10_000);
    expect(waited.answered).toBe("qa-w-owner");
    expect(waited.scores["qa-w-owner"]!.cycles).toBeGreaterThanOrEqual(4);
    const unwaited = detect(recording, { announcement: false });
    expect(unwaited.window).toMatchObject({ startMs: 2_000, announcementMs: 0 });
    expect(unwaited.scores["qa-w-owner"]!.cycles).toBeLessThan(waited.scores["qa-w-owner"]!.cycles);
  });

  it("leaves the window alone for a call with no announcement", () => {
    expect(detect(call("pixel")).window).toMatchObject({ startMs: 2_000, endMs: 12_000, announcementMs: 0 });
  });
});

describe("the judging window", () => {
  it("does not count a code that only starts 9 s after answer", () => {
    expect(detect(call("pixel", { startMs: 9_000 })).verdict).not.toBe("heard");
  });

  it("calls a code that ended before 2 s silent", () => {
    const early = codeSamples("pixel", { sampleRate: RATE, cycles: 1 });
    const padded = new Float32Array(RATE * 14);
    padded.set(early);
    expect(detect(padded).verdict).toBe("silent");
  });

  it("starts the window at answer, not at the start of the recording", () => {
    const ringing = new Float32Array(RATE * 5);
    const recording = mix(ringing, delay(call("qa-c"), RATE, 5_000));
    expect(detect(recording, { answerOffsetMs: 5_000 }).answered).toBe("qa-c");
    expect(detect(recording, { windowEndMs: 6_000 }).verdict).not.toBe("heard");
  });
});
