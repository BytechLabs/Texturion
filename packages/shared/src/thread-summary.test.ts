/**
 * #247 — the rule that decides whether a catch-up is offered at all.
 *
 * It matters that this is ONE rule rather than four. The server enforces it
 * before it reserves an AI unit, and each client applies it to decide whether
 * the control is even on screen. If those drift, a person is offered a button
 * that answers "there was nothing to summarise", or worse, is never offered one
 * on a thread the server would happily have summarised.
 *
 * Every assertion here is against the shipped constants rather than against a
 * number typed into the test, so retuning the rule fails on the BEHAVIOUR that
 * changed rather than on arithmetic somebody has to redo by hand.
 */
import { describe, expect, it } from "vitest";

import {
  isThreadSummarySection,
  shouldOfferThreadSummary,
  THREAD_SUMMARY_ATTRIBUTION,
  THREAD_SUMMARY_IDLE_MIN_MESSAGES,
  THREAD_SUMMARY_IDLE_MS,
  THREAD_SUMMARY_MIN_MESSAGES,
  THREAD_SUMMARY_SECTION_IDS,
  THREAD_SUMMARY_SECTIONS,
} from "./thread-summary";

const MINUTE = 60 * 1000;

describe("shouldOfferThreadSummary", () => {
  it("offers a catch-up on a long thread, however fresh it is", () => {
    expect(
      shouldOfferThreadSummary({
        messageCount: THREAD_SUMMARY_MIN_MESSAGES,
        idleMs: 0,
      }),
    ).toBe(true);
  });

  it("refuses one message below the length threshold", () => {
    // The boundary in the direction that costs money: at the threshold we spend
    // an AI unit, one below it we do not. A rule whose edge is untested is a
    // rule that quietly moves.
    expect(
      shouldOfferThreadSummary({
        messageCount: THREAD_SUMMARY_MIN_MESSAGES - 1,
        idleMs: 0,
      }),
    ).toBe(false);
  });

  it("offers one on a shorter thread that has gone quiet long enough", () => {
    // The second door, and the reason it exists: the cost this feature attacks
    // is not only length, it is having FORGOTTEN. "Call me after the 15th"
    // three weeks ago is six messages nobody remembers.
    expect(
      shouldOfferThreadSummary({
        messageCount: THREAD_SUMMARY_IDLE_MIN_MESSAGES,
        idleMs: THREAD_SUMMARY_IDLE_MS,
      }),
    ).toBe(true);
  });

  it("refuses a thread that is quiet but nearly empty", () => {
    // Two messages from a month ago are read in four seconds, and a summary of
    // them can only be longer than they are.
    expect(
      shouldOfferThreadSummary({
        messageCount: THREAD_SUMMARY_IDLE_MIN_MESSAGES - 1,
        idleMs: THREAD_SUMMARY_IDLE_MS * 10,
      }),
    ).toBe(false);
  });

  it("refuses a short thread that is still live", () => {
    expect(
      shouldOfferThreadSummary({
        messageCount: THREAD_SUMMARY_IDLE_MIN_MESSAGES,
        idleMs: THREAD_SUMMARY_IDLE_MS - MINUTE,
      }),
    ).toBe(false);
  });

  it("refuses an empty thread outright", () => {
    expect(shouldOfferThreadSummary({ messageCount: 0, idleMs: 0 })).toBe(false);
    expect(
      shouldOfferThreadSummary({ messageCount: 0, idleMs: THREAD_SUMMARY_IDLE_MS }),
    ).toBe(false);
  });

  it("keeps the idle door strictly below the length door", () => {
    // Not arithmetic for its own sake: if the idle minimum ever reached the
    // length threshold, the second rule would be dead code and every short
    // forgotten thread would silently stop being offered a catch-up.
    expect(THREAD_SUMMARY_IDLE_MIN_MESSAGES).toBeLessThan(
      THREAD_SUMMARY_MIN_MESSAGES,
    );
  });
});

describe("the three sections", () => {
  it("reads in the order somebody opening a thread cold asks the questions", () => {
    expect(THREAD_SUMMARY_SECTION_IDS).toEqual(["asked", "we_said", "open"]);
  });

  it("gives every section a heading, and no two the same", () => {
    const labels = THREAD_SUMMARY_SECTIONS.map((section) => section.label);
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(3);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("recognises exactly the three ids and nothing else", () => {
    // The model is asked for these keys and will occasionally invent a fourth.
    // This predicate is what the sanitiser drops it on.
    for (const id of THREAD_SUMMARY_SECTION_IDS) {
      expect(isThreadSummarySection(id)).toBe(true);
    }
    expect(isThreadSummarySection("next_steps")).toBe(false);
    expect(isThreadSummarySection("")).toBe(false);
    expect(isThreadSummarySection("ASKED")).toBe(false);
  });

  it("does not call the last section an instruction", () => {
    // "Still open" is a statement about the conversation. "Action items" would
    // be this surface telling a crew what to do, which #247 is explicit it must
    // not do: a summary is not a decision.
    const open = THREAD_SUMMARY_SECTIONS.find((section) => section.id === "open");
    expect(open?.label.toLowerCase()).not.toContain("action");
    expect(open?.label.toLowerCase()).not.toContain("todo");
  });
});

describe("attribution", () => {
  it("names Lou and points at the real messages", () => {
    // #247: summaries must be visibly Lou-generated and one tap from the raw
    // thread. The second half is what makes the first half more than a
    // disclaimer, so both have to be in the sentence.
    expect(THREAD_SUMMARY_ATTRIBUTION).toContain("Lou");
    expect(THREAD_SUMMARY_ATTRIBUTION.toLowerCase()).toContain("tap");
  });
});
