/**
 * #129/#133 pure call-display helpers: talk-time formatting and the
 * direction-aware outcome line, including the in-flight (null-outcome)
 * labels — the bare "Call" placeholder must never render.
 */
import { describe, expect, it } from "vitest";

import { callOutcomeLabel, formatCallDuration } from "./call";

describe("formatCallDuration", () => {
  it("renders seconds-only under a minute", () => {
    expect(formatCallDuration(58)).toBe("58s");
    expect(formatCallDuration(0)).toBe("0s");
  });

  it("renders whole minutes without a dangling 0s", () => {
    expect(formatCallDuration(120)).toBe("2m");
  });

  it("renders minutes and seconds", () => {
    expect(formatCallDuration(272)).toBe("4m 32s");
  });

  it("clamps negatives to zero", () => {
    expect(formatCallDuration(-5)).toBe("0s");
  });
});

describe("callOutcomeLabel", () => {
  it("inbound misses are 'Missed'", () => {
    expect(
      callOutcomeLabel({ outcome: "missed", direction: "inbound", forward_seconds: 0 }),
    ).toBe("Missed");
  });

  it("D38: an outbound no-answer is 'No answer', never 'Missed'", () => {
    expect(
      callOutcomeLabel({ outcome: "missed", direction: "outbound", forward_seconds: 0 }),
    ).toBe("No answer");
  });

  it("voicemail reads the same both directions", () => {
    expect(
      callOutcomeLabel({ outcome: "voicemail", direction: "inbound", forward_seconds: 0 }),
    ).toBe("Voicemail");
    expect(
      callOutcomeLabel({ outcome: "voicemail", direction: "outbound", forward_seconds: 0 }),
    ).toBe("Voicemail");
  });

  it("answered carries talk time when there is any", () => {
    expect(
      callOutcomeLabel({ outcome: "answered", direction: "inbound", forward_seconds: 272 }),
    ).toBe("Answered · 4m 32s");
    expect(
      callOutcomeLabel({ outcome: "answered", direction: "inbound", forward_seconds: 0 }),
    ).toBe("Answered");
  });

  it("D38: outbound answered speaks from the crew's side", () => {
    expect(
      callOutcomeLabel({ outcome: "answered", direction: "outbound", forward_seconds: 192 }),
    ).toBe("You called · 3m 12s");
    expect(
      callOutcomeLabel({ outcome: "answered", direction: "outbound", forward_seconds: 0 }),
    ).toBe("You called");
  });

  it("#191: names the acting placer/answerer on an answered call", () => {
    expect(
      callOutcomeLabel({
        outcome: "answered",
        direction: "outbound",
        forward_seconds: 192,
        answered_by_name: "Sam",
      }),
    ).toBe("Sam called · 3m 12s");
    expect(
      callOutcomeLabel({
        outcome: "answered",
        direction: "inbound",
        forward_seconds: 272,
        answered_by_name: "Sam",
      }),
    ).toBe("Answered by Sam · 4m 32s");
  });

  it("#191: falls back when the actor is unknown (legacy rows) — 'You called' / 'Answered'", () => {
    expect(
      callOutcomeLabel({ outcome: "answered", direction: "outbound", forward_seconds: 0 }),
    ).toBe("You called");
    expect(
      callOutcomeLabel({ outcome: "answered", direction: "inbound", forward_seconds: 0 }),
    ).toBe("Answered");
  });

  it("#133: a null outcome is in flight — 'Calling…' outbound, 'In progress' inbound", () => {
    expect(
      callOutcomeLabel({ outcome: null, direction: "outbound", forward_seconds: 0 }),
    ).toBe("Calling…");
    expect(
      callOutcomeLabel({ outcome: null, direction: "inbound", forward_seconds: 0 }),
    ).toBe("In progress");
  });

  it("a legacy row with no direction reads as inbound and never says bare 'Call'", () => {
    expect(callOutcomeLabel({ outcome: null, forward_seconds: 0 })).toBe(
      "In progress",
    );
  });
});
