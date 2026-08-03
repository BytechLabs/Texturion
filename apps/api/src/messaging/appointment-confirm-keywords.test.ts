/**
 * #237 — a confirmation reply may not steal a carrier keyword.
 *
 * "Reply C to confirm" invites a short answer, and short answers are exactly
 * what the carrier layer already owns. `START_KEYWORDS` contains "YES": from an
 * opted-out contact that is a request to be texted again, which is carrier
 * truth and outranks anything this feature wants. `opt-out-carrier-truth` is
 * binding — only the customer can lift their own opt-out — so a confirmation
 * handler that consumed "YES" before the opt-out handler saw it would leave
 * somebody silenced who had just asked to be un-silenced, and there is no way
 * back for either party.
 *
 * The overlap is legitimate and documented (`CONFIRM_KEYWORDS_ALSO_CARRIER`).
 * What is NOT legitimate is a new one appearing without anybody noticing, which
 * is what this test exists for: "CANCEL" reads like a perfectly sensible word
 * to add to a confirmation vocabulary, and it is a STOP keyword.
 */
import {
  APPOINTMENT_CONFIRM_KEYWORDS,
  CONFIRM_KEYWORDS_ALSO_CARRIER,
  isAppointmentConfirmation,
} from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { HELP_KEYWORDS, START_KEYWORDS, STOP_KEYWORDS } from "./keywords";

describe("#237 confirmation replies against the carrier vocabulary", () => {
  it("finds both vocabularies, so a rename cannot make this vacuous", () => {
    expect(APPOINTMENT_CONFIRM_KEYWORDS.length).toBeGreaterThan(3);
    expect(STOP_KEYWORDS.size + START_KEYWORDS.size + HELP_KEYWORDS.size)
      .toBeGreaterThan(5);
  });

  it("overlaps the carrier keywords only where it says it does", () => {
    const carrier = new Set([
      ...STOP_KEYWORDS,
      ...START_KEYWORDS,
      ...HELP_KEYWORDS,
    ]);
    const overlap = APPOINTMENT_CONFIRM_KEYWORDS.filter((word) =>
      carrier.has(word),
    ).sort();

    expect(
      overlap,
      `\n\nThese confirmation words are ALSO carrier keywords:\n  ` +
        overlap.join(", ") +
        `\n\nOnly the ones in CONFIRM_KEYWORDS_ALSO_CARRIER are accounted for.\n` +
        `A carrier keyword means what the carrier says it means — "CANCEL" is a\n` +
        `STOP, and consuming it as a confirmation would silence a customer who\n` +
        `asked to be left alone, permanently and with no way back.\n` +
        `Either drop the word, or add it to that list AND make the inbound\n` +
        `handler run the opt-out layer first.\n`,
    ).toEqual([...CONFIRM_KEYWORDS_ALSO_CARRIER].sort());
  });

  it("never confirms on a STOP word, whatever the casing", () => {
    // The direction with a customer on the end of it. Each of these is somebody
    // asking not to be texted; not one of them may read as "see you Thursday".
    for (const word of STOP_KEYWORDS) {
      for (const shape of [word, word.toLowerCase(), `${word}.`, ` ${word} `]) {
        expect(
          isAppointmentConfirmation(shape),
          `"${shape}" was read as a confirmation`,
        ).toBe(false);
      }
    }
  });

  it("confirms on the short answers a person actually thumbs", () => {
    for (const shape of ["C", "c", "c.", " C ", "Yes", "yes!", "ok", "Confirmed"]) {
      expect(isAppointmentConfirmation(shape), shape).toBe(true);
    }
  });

  it("does not confirm on a sentence that merely contains one", () => {
    // The reschedule request #237 asks to route to a human. "No, Tuesday is
    // better" contains no confirm word; "can we confirm another day?" contains
    // one and is the opposite of a confirmation.
    for (const shape of [
      "can we confirm another day?",
      "No, Tuesday is better",
      "yes but can you come earlier",
      "ok so what time exactly",
    ]) {
      expect(isAppointmentConfirmation(shape), shape).toBe(false);
    }
  });
});
