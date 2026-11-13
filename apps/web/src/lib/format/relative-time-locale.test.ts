/**
 * #228: a time in a list row speaks the reader's language.
 *
 * The old relative formatter took its translator as an optional argument that
 * defaulted to English, and thirty callers never passed one. The inbox list,
 * the For You queue and the call log therefore said `now` and `Tue` to a French
 * reader. #720 replaced it with `formatTimestamp`; the locale still rides on
 * the translator, so passing the translator is the whole job.
 */
import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";

import { formatTimestamp, twoClockLabel } from "./time";

const NOW = new Date("2026-07-15T12:00:00.000Z");

const UTC = "UTC";

describe("#228 formatTimestamp follows the translator", () => {
  it("says `now` in the reader's language", () => {
    const iso = new Date(NOW.getTime() - 5_000).toISOString();
    const at = (locale: "en" | "fr-CA") =>
      formatTimestamp(iso, { now: NOW, t: makeTranslate(locale), timeZone: UTC });
    expect(at("en")).toBe("now");
    expect(at("fr-CA")).toBe("maintenant");
  });

  it("names the weekday and the month in the reader's language, from the translator alone", () => {
    const threeDays = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();
    const lastYear = "2025-03-05T12:00:00.000Z";

    const en = makeTranslate("en");
    const fr = makeTranslate("fr-CA");

    // The locale is NOT passed as a fourth argument: carrying it on the
    // translator is what stops a caller from supplying a mismatched pair.
    const draw = (iso: string, t: typeof en) =>
      formatTimestamp(iso, { now: NOW, t, timeZone: UTC });
    expect(draw(threeDays, en)).toMatch(/^Sun$/);
    expect(draw(threeDays, fr)).not.toBe("Sun");
    expect(draw(threeDays, fr)).toMatch(/dim/i);

    expect(draw(lastYear, en)).toBe("Mar 5, 2025");
    expect(draw(lastYear, fr)).toMatch(/mars/i);
  });

  it("keeps the English output unchanged when no translator is given", () => {
    const iso = new Date(NOW.getTime() - 5_000).toISOString();
    expect(formatTimestamp(iso, { now: NOW, timeZone: UTC })).toBe("now");
  });
});

describe("#228 the two-clock label follows the reader's language", () => {
  it("writes the weekday in the locale it is given", () => {
    const iso = "2026-07-14T15:00:00.000Z";
    const en = twoClockLabel(iso, "America/Toronto", "America/Toronto", "en");
    const fr = twoClockLabel(iso, "America/Toronto", "America/Toronto", "fr-CA");
    expect(en).toMatch(/Tue/);
    expect(fr).not.toMatch(/Tue/);
    expect(fr).toMatch(/mar/i);
  });
});
