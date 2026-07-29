import { describe, expect, it } from "vitest";

import { defaultGreeting, sanitizeGreeting } from "./inbound-ring";

/**
 * #432 — a caller must never be recorded having heard nothing.
 *
 * Live calls are never recorded: `telnyx-record-start` is reachable only from
 * `voicemail_greeting`. So the consent basis for the one recording that DOES
 * happen is the greeting itself — a caller hears a message, understands they
 * are leaving one, and chooses to speak.
 *
 * `greeting` is nullable on the machine, and the transition into
 * `voicemail_recording` depends on the STATE, not on what was said. That makes
 * "what plays when the greeting is null" the question the consent rests on,
 * and it deserves a test rather than a reading of the code.
 *
 * The answer is the good one: `greetingText` routes every greeting through
 * `sanitizeGreeting`, which falls back to a notice of ours. Nothing here
 * changes that — it pins it, because PIPEDA requires the individual be
 * informed, and silence does not inform anybody.
 */

const COMPANY = "Ace Plumbing";

/** Does this text tell a caller a message is being taken? */
function isUnambiguousNotice(text: string): boolean {
  return /leave a message/i.test(text);
}

describe("#432 — the voicemail notice cannot be silent", () => {
  it("falls back to our own notice when the owner never set a greeting", () => {
    const spoken = sanitizeGreeting(null, COMPANY);
    expect(spoken).toBe(defaultGreeting(COMPANY));
    expect(isUnambiguousNotice(spoken)).toBe(true);
  });

  it("falls back for every shape of empty a greeting can take", () => {
    // A greeting saved as spaces, a newline, or control characters is empty
    // once sanitized — and each is a real thing an owner can type into a form.
    // If any of them produced an empty utterance, a caller would be recorded
    // after hearing nothing at all.
    for (const raw of ["", "   ", "\n\t", "\u200b", "\u0000\u0001"]) {
      const spoken = sanitizeGreeting(raw, COMPANY);
      expect(spoken, JSON.stringify(raw)).toBe(defaultGreeting(COMPANY));
      expect(isUnambiguousNotice(spoken), JSON.stringify(raw)).toBe(true);
    }
  });

  it("never returns an empty string, whatever it is given", () => {
    // The property the consent actually rests on, stated once and directly.
    for (const raw of [null, "", "  ", "\u0000", "x"]) {
      expect(sanitizeGreeting(raw, COMPANY).trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the owner's own words when they wrote some", () => {
    // The fallback must not override a real greeting — an owner who recorded
    // their own notice has given a better one than ours.
    expect(sanitizeGreeting("Back Monday, leave a message", COMPANY)).toBe(
      "Back Monday, leave a message",
    );
  });

  it("bounds a pathological greeting rather than dropping it", () => {
    // Truncating keeps SOME notice; refusing would leave silence, which is the
    // one outcome this whole file exists to prevent.
    const spoken = sanitizeGreeting("a".repeat(5000), COMPANY);
    expect(spoken.length).toBe(500);
  });

  it("states our default notice in words a caller cannot misread", () => {
    const text = defaultGreeting(COMPANY);
    expect(text).toContain(COMPANY);
    expect(isUnambiguousNotice(text)).toBe(true);
    // "after the beep" is what makes it a recording notice rather than an
    // apology — it tells the caller their voice is about to be captured.
    expect(text).toMatch(/after the beep/i);
  });
});
