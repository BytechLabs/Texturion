import { describe, expect, it } from "vitest";

import {
  wrapUpFailureMessage,
  wrapUpFileName,
  wrapUpOutcome,
  WRAP_UP_MAX_SECONDS,
  type WrapUpFailureReason,
} from "./wrap-up-transcript";

/**
 * #507 Phase 1 — dictation is BEST EFFORT, and the whole point of the reason
 * codes is that a member can tell which failure they got.
 *
 * The failure that shipped before these existed anywhere in this product was
 * one shrug for every cause ("nothing to suggest"), which hid real breakage
 * behind what looked like a normal empty result — the founder hit exactly that
 * with reply drafting. So each reason gets its own sentence, and each sentence
 * has to survive a rename of the reason on the server: an unmapped one falls to
 * the default rather than rendering "undefined".
 */
describe("wrapUpFailureMessage", () => {
  const reasons: WrapUpFailureReason[] = [
    "too_long",
    "disabled",
    "over_cap",
    "model_error",
    "unusable_output",
    "unavailable",
  ];

  it("maps every reason to a distinct, finished sentence", () => {
    const seen = new Set<string>();
    for (const reason of reasons) {
      const message = wrapUpFailureMessage(reason);
      expect(message.length, reason).toBeGreaterThan(20);
      expect(message.endsWith("."), reason).toBe(true);
      seen.add(message);
    }
    // model_error and unavailable are deliberately the same sentence — both
    // mean "the model did not answer" and both are worth retrying, and telling
    // a plumber which layer failed helps nobody.
    expect(seen.size).toBe(reasons.length - 1);
  });

  it("says the length limit in the units a person counts in", () => {
    expect(wrapUpFailureMessage("too_long")).toContain(
      `${WRAP_UP_MAX_SECONDS / 60} minutes`,
    );
  });

  it("points a workspace that switched it off at the setting", () => {
    const message = wrapUpFailureMessage("disabled");
    expect(message).toContain("turned off");
    expect(message).toContain("Settings");
    // Never "try again": there is nothing to retry until somebody flips it.
    expect(message).not.toContain("Try again");
  });

  it("tells a capped workspace when it comes back, not to keep pressing", () => {
    const message = wrapUpFailureMessage("over_cap");
    expect(message).toContain("next month");
    expect(message).not.toContain("Try again");
  });

  it("offers a retry only where retrying can work", () => {
    expect(wrapUpFailureMessage("model_error")).toContain("Try again");
    expect(wrapUpFailureMessage("unavailable")).toContain("Try again");
    expect(wrapUpFailureMessage("unusable_output")).toContain("Say it again");
  });

  it("never leaves an unknown reason rendering 'undefined'", () => {
    expect(wrapUpFailureMessage(undefined)).toContain("Type the note");
    expect(
      wrapUpFailureMessage("something_new" as WrapUpFailureReason),
    ).toContain("Type the note");
  });

  /**
   * EVERY failure ends with the thing that always works. Dictation is a
   * shortcut; a member left with a dead mic and no next move is the failure
   * mode the brief calls the only unacceptable one.
   */
  it("always leaves the member holding the keyboard", () => {
    for (const reason of [...reasons, undefined]) {
      expect(wrapUpFailureMessage(reason).toLowerCase(), String(reason)).toMatch(
        /type (the note|it)/,
      );
    }
  });

  /**
   * D117 — the line the whole feature rests on. No string may suggest the
   * product hears a call or a customer. This is a copy test on purpose: the
   * false version of this sentence is not a bug anything else would catch.
   */
  it("never implies we listened to the call or the customer", () => {
    for (const reason of [...reasons, undefined]) {
      const message = wrapUpFailureMessage(reason).toLowerCase();
      expect(message, String(reason)).not.toContain("the call");
      expect(message, String(reason)).not.toContain("customer");
      expect(message, String(reason)).not.toContain("caller");
    }
  });
});

/**
 * #431 — what the member did with the words Lou wrote down.
 *
 * The counter has to be trustworthy enough to keep or kill the feature on, and
 * the trap here is that a wrap-up is APPENDED to whatever was already typed. A
 * naive "does the saved note equal the transcript" would report "corrected
 * first" for every note that had a word of context in front of it.
 */
describe("wrapUpOutcome", () => {
  it("reports nothing when no dictation happened", () => {
    expect(wrapUpOutcome(null, "typed the whole thing myself")).toBeNull();
  });

  it("counts an untouched dictation as posted as written", () => {
    expect(
      wrapUpOutcome(
        { before: "", after: "Quoted him $2,400 for the tank." },
        "Quoted him $2,400 for the tank.",
      ),
    ).toBe("used");
  });

  it("counts an untouched dictation appended to typed context as used", () => {
    // The case a transcript-equality check gets wrong: the member typed
    // "Called back:" first and changed nothing Lou wrote.
    expect(
      wrapUpOutcome(
        { before: "Called back:", after: "Called back:\nParts Thursday." },
        "Called back:\nParts Thursday.",
      ),
    ).toBe("used");
  });

  it("counts a correction inside the dictation as corrected first", () => {
    expect(
      wrapUpOutcome(
        { before: "", after: "Quoted him $2,400 for the tank." },
        "Quoted him $2,450 for the tank.",
      ),
    ).toBe("edited");
  });

  it("counts a dictation deleted back to what was there as thrown away", () => {
    expect(
      wrapUpOutcome(
        { before: "Called back:", after: "Called back:\nParts Thursday." },
        "Called back:",
      ),
    ).toBe("discarded");
  });

  it("counts an emptied box as thrown away, including a files-only note", () => {
    expect(
      wrapUpOutcome({ before: "", after: "Parts Thursday." }, ""),
    ).toBe("discarded");
  });

  it("does not call trailing whitespace an edit", () => {
    expect(
      wrapUpOutcome(
        { before: "", after: "Parts Thursday." },
        "Parts Thursday.\n",
      ),
    ).toBe("used");
  });
});

/**
 * MediaRecorder hands back a different container per engine and the server has
 * no way to infer one, so the filename carries it. Every value here is inside
 * Whisper's accepted set.
 */
describe("wrapUpFileName", () => {
  it("names Safari's container", () => {
    expect(wrapUpFileName("audio/mp4")).toBe("wrap-up.mp4");
  });

  it("names the Chromium/Firefox container, codecs and all", () => {
    expect(wrapUpFileName("audio/webm;codecs=opus")).toBe("wrap-up.webm");
  });

  it("names an Ogg container", () => {
    expect(wrapUpFileName("audio/ogg;codecs=opus")).toBe("wrap-up.ogg");
  });

  it("falls back to WebM rather than an extensionless name", () => {
    expect(wrapUpFileName("")).toBe("wrap-up.webm");
  });
});
