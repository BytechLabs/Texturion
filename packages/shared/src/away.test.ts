/**
 * #414 ask 5 — the away reply's copy and its handler used to live apart.
 *
 * Three clients each carried their own copy of the default and previewed it;
 * the server sent the owner's text and nothing at all when it was blank. The
 * rule below is the one MCTB has had since #192: the toggle decides WHETHER,
 * the message always exists.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_AWAY_MESSAGE, effectiveAwayMessage } from "./away";
import { effectiveMctbMessage } from "./mctb";
import {
  mentionsEmergencyKeyword,
  unrecognizedReplyKeyword,
} from "./emergency";

describe("what the away reply actually sends", () => {
  it("uses the owner's words when they wrote some", () => {
    expect(effectiveAwayMessage("Back Monday.")).toEqual({
      message: "Back Monday.",
      custom: true,
    });
  });

  it.each([null, undefined, "", "   ", "\n\t "])(
    "falls back to the product default for %j",
    (blank) => {
      const result = effectiveAwayMessage(blank);
      expect(result.message).toBe(DEFAULT_AWAY_MESSAGE);
      expect(result.custom).toBe(false);
    },
  );

  it("resolves blank exactly the way MCTB does", () => {
    // Two auto-send surfaces resolving their copy differently is how these
    // drifted apart. Same shape, asserted.
    const away = effectiveAwayMessage("  ");
    const mctb = effectiveMctbMessage("  ");
    expect(away.custom).toBe(mctb.custom);
    expect(away.message.length).toBeGreaterThan(0);
    expect(mctb.message.length).toBeGreaterThan(0);
  });
});

describe("the default's own promise is one the product keeps", () => {
  it("invites a keyword the emergency handler recognises", () => {
    // This is the whole of #414: the sentence asking a homeowner to reply
    // URGENT is only honest while URGENT wakes the crew. If the default is
    // ever reworded to a word we do not watch for, this fails.
    expect(mentionsEmergencyKeyword(DEFAULT_AWAY_MESSAGE)).toBe(true);
    expect(unrecognizedReplyKeyword(DEFAULT_AWAY_MESSAGE)).toBeNull();
  });
});
