import { describe, expect, it } from "vitest";

import {
  SATISFACTION_ARC_MIN_DELTA,
  SATISFACTION_MIN_SAMPLE,
  formatSatisfaction,
  poorRatingLine,
  satisfactionArcDirection,
  SATISFACTION_COPY,
} from "./satisfaction";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — this module names keys now, so the tests resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const sayEn = (key: string): string => look(WEB_EN, key);
const sayFr = (key: string): string => look(WEB_FR, key);


describe("formatSatisfaction", () => {
  it("SF-1: renders an em dash rather than a zero nobody could score", () => {
    // 0.0 would be a score outside the 1–5 scale, i.e. the panel lying about a
    // workspace nobody has answered for.
    expect(formatSatisfaction(null)).toBe("—");
    expect(formatSatisfaction(undefined)).toBe("—");
    expect(formatSatisfaction(Number.NaN)).toBe("—");
  });

  it("SF-2: one decimal, because a second is noise on a 1-5 scale", () => {
    expect(formatSatisfaction(4.25)).toBe("4.3");
    expect(formatSatisfaction(5)).toBe("5.0");
  });
});

describe("satisfactionArcDirection", () => {
  it("SF-3: a move smaller than the threshold is not a direction", () => {
    expect(satisfactionArcDirection(0.1)).toBeNull();
    expect(satisfactionArcDirection(-0.1)).toBeNull();
    expect(satisfactionArcDirection(0)).toBeNull();
  });

  it("SF-4: names both directions, including the unflattering one", () => {
    expect(satisfactionArcDirection(SATISFACTION_ARC_MIN_DELTA)).toBe("better");
    expect(satisfactionArcDirection(-0.4)).toBe("worse");
  });

  it("SF-5: no baseline is 'we do not know', not 'no change'", () => {
    expect(satisfactionArcDirection(null)).toBeNull();
    expect(satisfactionArcDirection(undefined)).toBeNull();
  });
});

describe("poorRatingLine", () => {
  it("SF-6: counts as work to do, and gets the singular right", () => {
    expect(poorRatingLine(1, sayEn)).toBe("1 job needed a call back");
    expect(poorRatingLine(3, sayEn)).toBe("3 jobs needed a call back");
  });

  it("SF-8 (#228): the French agrees its VERB with the count", () => {
    // Why these are two whole sentences and not a count plus a shared tail.
    // English changes one letter; French changes the verb, so a fragment
    // would be wrong in one of the two cases whichever way it was written.
    expect(poorRatingLine(1, sayFr)).toBe("1 travail a nécessité un rappel");
    expect(poorRatingLine(3, sayFr)).toBe("3 travaux ont nécessité un rappel");
    expect(poorRatingLine(3, sayFr), "a variable survived").not.toMatch(/\{/);
  });
});

describe("#228 the panel's five states", () => {
  it("resolves every one, in both languages", () => {
    for (const key of Object.values(SATISFACTION_COPY)) {
      for (const [language, say] of [
        ["English", sayEn],
        ["French", sayFr],
      ] as const) {
        expect(say(key).length, `${language} for ${key}`).toBeGreaterThan(0);
      }
      expect(sayFr(key), `${key} is not translated`).not.toBe(sayEn(key));
    }
  });

  it("names the keys both phones already say", () => {
    // Four of the five were already being said in French on Android and iOS
    // while this module fed the web English. The point of the conversion was
    // to collapse that, so it is worth pinning that the names did not drift
    // into a third spelling on the way.
    expect(SATISFACTION_COPY.none_asked).toBe("inbox.satisfactionGapNoneAsked");
    expect(SATISFACTION_COPY.none_answered).toBe(
      "inbox.satisfactionGapNoneAnswered",
    );
    expect(SATISFACTION_COPY.too_few).toBe("inbox.satisfactionMemberTooFew");
    expect(SATISFACTION_COPY.per_member_off).toBe(
      "inbox.satisfactionByMemberOff",
    );
  });
});

describe("the sample floor", () => {
  it("SF-7: is high enough that one bad answer cannot swing a point", () => {
    // The floor's whole justification. With four answers a single 1 moves the
    // mean by more than a point; at the floor it must not. If somebody lowers
    // this constant, this is the argument they have to answer.
    const good = Array(SATISFACTION_MIN_SAMPLE - 1).fill(5);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const swing = mean(good) - mean([...good, 1]);
    expect(swing).toBeLessThan(1);
  });
});
