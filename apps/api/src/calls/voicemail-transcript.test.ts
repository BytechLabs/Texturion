import { describe, expect, it } from "vitest";

import {
  sanitizeTranscript,
  shouldTranscribe,
  transcriptText,
  VOICEMAIL_TRANSCRIPT_ALERT_THRESHOLD,
  VOICEMAIL_TRANSCRIPT_MAX_CHARS,
  VOICEMAIL_TRANSCRIPT_MAX_SECONDS,
  VOICEMAIL_TRANSCRIPT_MONTHLY_CAP,
  transcriptInput,
} from "./voicemail-transcript";

describe("shouldTranscribe", () => {
  it("takes a recording of ordinary length", () => {
    expect(shouldTranscribe(1)).toBe(true);
    expect(shouldTranscribe(42)).toBe(true);
    expect(shouldTranscribe(VOICEMAIL_TRANSCRIPT_MAX_SECONDS)).toBe(true);
  });

  it("skips an empty one and a stuck one", () => {
    // Paying per audio minute for a recording that ran away is exactly the
    // runaway the cap exists to stop.
    expect(shouldTranscribe(0)).toBe(false);
    expect(shouldTranscribe(-1)).toBe(false);
    expect(shouldTranscribe(VOICEMAIL_TRANSCRIPT_MAX_SECONDS + 1)).toBe(false);
  });
});

describe("transcriptText", () => {
  it("reads the documented envelope", () => {
    expect(transcriptText({ text: "can you come tuesday" })).toBe(
      "can you come tuesday",
    );
  });

  it("reads the shapes a binding might hand back instead", () => {
    // Reply drafting shipped assuming one shape, got another in production,
    // and returned empty for every caller. Read several rather than assume.
    expect(transcriptText("bare string")).toBe("bare string");
    expect(transcriptText({ transcription: "alt key" })).toBe("alt key");
    expect(transcriptText({ output_text: "another" })).toBe("another");
    expect(transcriptText({ result: { text: "nested" } })).toBe("nested");
  });

  it("returns null when there is no text anywhere", () => {
    expect(transcriptText(null)).toBeNull();
    expect(transcriptText(undefined)).toBeNull();
    expect(transcriptText({})).toBeNull();
    expect(transcriptText({ text: "" })).toBeNull();
    expect(transcriptText({ words: ["a"] })).toBeNull();
  });
});

describe("sanitizeTranscript", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitizeTranscript({ text: "  hi   there\n\nagain  " })).toBe(
      "hi there again",
    );
  });

  it("treats a transcript of silence as no transcript", () => {
    // Whisper emits filler for a recording with no speech. An empty bubble
    // under the player is worse than no bubble.
    expect(sanitizeTranscript({ text: "   " })).toBeNull();
    expect(sanitizeTranscript({ text: "." })).toBeNull();
    expect(sanitizeTranscript({ text: " - " })).toBeNull();
    // Two real characters is a message, however short.
    expect(sanitizeTranscript({ text: "ok" })).toBe("ok");
  });

  it("caps a degenerate transcript rather than storing it whole", () => {
    const long = sanitizeTranscript({ text: "word ".repeat(2000) });
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(VOICEMAIL_TRANSCRIPT_MAX_CHARS);
    expect(long!.endsWith("…")).toBe(true);
  });

  it("leaves an ordinary transcript untouched", () => {
    const said = "Hi, it's Dana. The tap upstairs is leaking again.";
    expect(sanitizeTranscript({ text: said })).toBe(said);
  });
});

describe("cost posture", () => {
  it("alerts before the cap, not at it", () => {
    expect(VOICEMAIL_TRANSCRIPT_ALERT_THRESHOLD).toBeLessThan(
      VOICEMAIL_TRANSCRIPT_MONTHLY_CAP,
    );
    expect(VOICEMAIL_TRANSCRIPT_ALERT_THRESHOLD).toBeGreaterThan(0);
  });
});

describe("transcriptInput", () => {
  it("passes the audio as base64, not a byte array", () => {
    // A five-minute recording is about a million array elements otherwise,
    // built inside a 128 MB Worker that is already holding the raw buffer.
    const input = transcriptInput("AAAA");
    expect(input.audio).toBe("AAAA");
    expect(typeof input.audio).toBe("string");
  });

  it("turns off conditioning on previous text", () => {
    // Left on, Whisper loops on near-silence and emits the same phrase over
    // and over, which would read as a real message rather than as nothing.
    expect(transcriptInput("x").condition_on_previous_text).toBe(false);
  });

  it("pins the language rather than detecting it from noise", () => {
    expect(transcriptInput("x").language).toBe("en");
    expect(transcriptInput("x").task).toBe("transcribe");
  });
});
