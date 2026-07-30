import { describe, expect, it } from "vitest";

import { draftOutcome, enrichmentOutcome, type EnrichmentState } from "./outcome";

/**
 * #431 — these three functions decide the number the keep-or-kill decision rests
 * on, so what they refuse to report matters as much as what they do.
 *
 * The dominant risk is not a wrong label. It is reporting an outcome where none
 * happened: Lou is involved in a small fraction of the messages a crew sends, so
 * a rule that says "discarded" whenever a suggestion was not used would bury the
 * real signal under every ordinary typed message and make the ledger read as a
 * catastrophic rejection rate. Every null below is that guard.
 */

const NOTHING: EnrichmentState = {
  suggestedAddress: false,
  suggestedDue: false,
  addressEdited: false,
  addressCleared: false,
  dueEdited: false,
  dueCleared: false,
};

describe("draftOutcome", () => {
  it("reports nothing when no draft was ever shown", () => {
    // The important one. Most messages are typed with Lou uninvolved.
    expect(
      draftOutcome({ shown: false, picked: null, sent: "on my way" }),
    ).toBeNull();
  });

  it("counts a draft sent untouched as used", () => {
    expect(
      draftOutcome({ shown: true, picked: "On my way", sent: "On my way" }),
    ).toBe("used");
  });

  it("ignores whitespace the composer itself adds", () => {
    // The composer trims on send. Counting a trailing newline as an edit would
    // inflate "changed first" with a difference nobody made.
    expect(
      draftOutcome({ shown: true, picked: "On my way", sent: "On my way\n" }),
    ).toBe("used");
  });

  it("counts a draft changed before sending as edited", () => {
    expect(
      draftOutcome({
        shown: true,
        picked: "On my way",
        sent: "On my way, 20 min",
      }),
    ).toBe("edited");
  });

  it("counts drafts shown and ignored as discarded", () => {
    expect(
      draftOutcome({ shown: true, picked: null, sent: "different words" }),
    ).toBe("discarded");
  });
});

describe("enrichmentOutcome", () => {
  it("reports nothing when enrichment filled in nothing", () => {
    // Enrichment runs on every make-a-task and often finds no address at all.
    // That is not a rejected suggestion.
    expect(enrichmentOutcome(NOTHING)).toBeNull();
  });

  it("counts untouched suggestions as used", () => {
    expect(
      enrichmentOutcome({
        ...NOTHING,
        suggestedAddress: true,
        suggestedDue: true,
      }),
    ).toBe("used");
  });

  it("counts a corrected address as edited, not used", () => {
    // A suggestion that needed fixing is not a suggestion that was right.
    expect(
      enrichmentOutcome({
        ...NOTHING,
        suggestedAddress: true,
        addressEdited: true,
      }),
    ).toBe("edited");
  });

  it("counts one part kept and the other thrown away as edited", () => {
    // Half right. Calling this "kept as filled in" would flatter the model;
    // calling it "cleared" would understate what it saved.
    expect(
      enrichmentOutcome({
        ...NOTHING,
        suggestedAddress: true,
        suggestedDue: true,
        dueCleared: true,
      }),
    ).toBe("edited");
  });

  it("counts every suggested part thrown away as cleared", () => {
    expect(
      enrichmentOutcome({
        ...NOTHING,
        suggestedAddress: true,
        suggestedDue: true,
        addressCleared: true,
        dueCleared: true,
      }),
    ).toBe("discarded");
  });

  it("ignores a cleared field that was never suggested", () => {
    // Somebody clearing a due date they typed themselves says nothing about Lou.
    expect(
      enrichmentOutcome({
        ...NOTHING,
        suggestedAddress: true,
        dueCleared: true,
      }),
    ).toBe("used");
  });
});

describe("voicemail transcripts are decided on the server", () => {
  it("exports no client-side transcript rule", async () => {
    // Not an omission. `GET /v1/calls/:id/voicemail` is the only way to obtain
    // playable audio, so "played the audio anyway" is fully visible server-side
    // and is recorded there for all three clients at once. The positive case has
    // no honest client form — "read the words and moved on" would have to be
    // inferred from unmount and scroll timing, and on a list screen a row
    // disposes when you scroll past it, so the inference would count "scrolled
    // by" as "read and satisfied".
    //
    // This test exists so that reintroducing a client-side rule is a deliberate
    // act with this reasoning in front of whoever does it.
    const rules: Record<string, unknown> = await import("./outcome");
    expect(Object.keys(rules).sort()).toEqual(["draftOutcome", "enrichmentOutcome"]);
  });
});
